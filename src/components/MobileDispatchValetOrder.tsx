import React, { useState, useEffect, useRef } from 'react';
import { geocodeAddress, isValidCoords } from '../utils/geocoding';
import { db, collection, doc, setDoc, getDoc, getDocs, onSnapshot, deleteDoc, clearCollection, getBaseApiUrl } from '../lib/dbProxy';
import { safeSetItem, safeGetItem } from '../utils/safeStorage';
import { MOCK_ALBUM_PHOTOS } from '../utils/mockImages';
import { 
  MapPin, 
  Phone, 
  Navigation, 
  Loader2, 
  CheckCircle, 
  Users, 
  Search,
  ArrowRight,
  ArrowLeft,
  Trash2,
  History,
  RefreshCw,
  FileText,
  X,
  Lock,
  Settings,
  Edit2,
  Car,
  Clock,
  Bike,
  QrCode,
  Camera,
  Info,
  Zap,
  Check,
  ClipboardList,
  Flag,
  User,
  ChevronDown,
  Headphones,
  MoreVertical,
  UserPlus,
  Filter,
  SlidersHorizontal,
  ShieldCheck,
  LogOut,
  Store
} from 'lucide-react';
import driverAvatar from '../assets/images/driver_avatar_1784017528877.jpg';
import { DRIVER_AVATAR_BASE64, DRIVER_MASCOT_BASE64 } from '../assets/images/driverImageConstants';

// Haversine Distance Formula (直线距离计算)
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

const getOrderSyncPrice = (ord: any): string => {
  if (!ord) return '¥40.00';
  const raw = ord.rawOrder || ord;
  const p = raw.calculatedTotalFee ?? raw.estimatedPrice ?? raw.price ?? raw.fare ?? raw.totalFee ?? raw.approxPrice ?? ord.calculatedTotalFee ?? ord.estimatedPrice ?? ord.price ?? ord.fare ?? ord.approxPrice;
  
  if (p !== undefined && p !== null && p !== '') {
    const num = parseFloat(p.toString().replace(/[^\d.]/g, ''));
    if (!isNaN(num) && num > 0) {
      return `¥${num.toFixed(2)}`;
    }
  }

  return '¥40.00';
};

// 推荐本地热门商户起点列表 (按当前所在城市动态过滤/生成)
function getCityMerchantRecommendations(rawCity: string) {
  const city = (rawCity || '银川').replace(/市$/, '').trim();

  const cityMap: Record<string, Array<{ name: string; desc: string }>> = {
    '银川': [
      { name: '北京东路铂金大厦', desc: '银川市兴庆区北京东路' },
      { name: '银川大悦城音乐餐吧', desc: '银川市金凤区正源北街' },
      { name: '银川金凤万达广场', desc: '银川市金凤区黄河东路' },
      { name: '悦海新天地餐饮街', desc: '银川市金凤区康平路' },
      { name: '温州商城酒店区', desc: '银川市兴庆区胜利街' },
      { name: '凯宾斯基饭店宴会厅', desc: '银川市金凤区北京中路' },
      { name: '鼓楼步行街酒店区', desc: '银川市兴庆区解放东街' },
      { name: '建发大枫林餐吧', desc: '银川市金凤区贺兰山中路' }
    ],
    '北京': [
      { name: '工体MIX酒吧', desc: '北京市朝阳区工体北路' },
      { name: '三里屯太古里酒楼', desc: '北京市朝阳区三里屯路' },
      { name: '簋街胡大饭庄', desc: '北京市东城区东直门内大街' },
      { name: '望京SOHO美食街', desc: '北京市朝阳区望京街' },
      { name: '国贸大酒店宴会厅', desc: '北京市朝阳区建国门外大街' },
      { name: '芳草地半岛餐吧', desc: '北京市朝阳区东大桥路' },
      { name: '五道口酒吧街', desc: '北京市海淀区成府路' },
      { name: '中关村1号餐饮中心', desc: '北京市海淀区北清路' }
    ],
    '上海': [
      { name: '外滩18号宴会厅', desc: '上海市黄浦区中山东一路' },
      { name: '新天地酒吧街', desc: '上海市黄浦区太仓路' },
      { name: '陆家嘴国金中心酒楼', desc: '上海市浦东新区世纪大道' },
      { name: '静安嘉里中心餐吧', desc: '上海市静安区南京西路' },
      { name: '衡山路酒吧区', desc: '上海市徐汇区衡山路' },
      { name: '芮欧百货美食区', desc: '上海市静安区南京西路' },
      { name: '豫园绿波廊大酒楼', desc: '上海市黄浦区豫园路' },
      { name: '淮海中路KTV酒吧', desc: '上海市黄浦区淮海中路' }
    ],
    '广州': [
      { name: '珠江新城兴盛路酒吧街', desc: '广州市天河区兴盛路' },
      { name: '太古汇大酒楼', desc: '广州市天河区天河路' },
      { name: '太古仓码头餐吧区', desc: '广州市海珠区革新路' },
      { name: '广州塔旋转餐厅', desc: '广州市海珠区阅江西路' },
      { name: '天河城美食广场', desc: '广州市天河区天河路' },
      { name: '北京路步行街酒家', desc: '广州市越秀区北京路' },
      { name: '建设六马路酒吧街', desc: '广州市越秀区建设六马路' },
      { name: '琶醍啤酒文化艺术区', desc: '广州市海珠区磨碟沙大街' }
    ],
    '深圳': [
      { name: '购物公园酒吧街', desc: '深圳市福田区民田路' },
      { name: '万象城大酒楼', desc: '深圳市罗湖区嘉宾路' },
      { name: '海上世界餐饮区', desc: '深圳市南山区望海路' },
      { name: '华润万象天地广场', desc: '深圳市南山区深南大道' },
      { name: '深圳湾1号酒店厅', desc: '深圳市南山区科苑南路' },
      { name: '卓悦中心酒吧街', desc: '深圳市福田区福华一路' },
      { name: '车公庙美食街', desc: '深圳市福田区深南大道' },
      { name: '科技园美食广场', desc: '深圳市南山区高新南一道' }
    ],
    '成都': [
      { name: '九眼桥酒吧街', desc: '成都市锦江区丝管路' },
      { name: '兰桂坊餐饮区', desc: '成都市锦江区水井街' },
      { name: '太古里大酒楼', desc: '成都市锦江区中纱帽街' },
      { name: '锦里古街酒家', desc: '成都市武侯区武侯祠大街' },
      { name: '339电视塔酒吧街', desc: '成都市成华区猛追湾街' },
      { name: '奎星楼街美食广场', desc: '成都市青羊区奎星楼街' },
      { name: '玉林路小酒馆', desc: '成都市武侯区玉林西路' },
      { name: '环球中心美食广场', desc: '成都市高新区天府大道' }
    ],
    '杭州': [
      { name: '湖滨银泰IN77', desc: '杭州市上城区延安路' },
      { name: '黄龙体育中心酒吧街', desc: '杭州市西湖区黄龙路' },
      { name: '钱江新城来福士', desc: '杭州市上城区新业路' },
      { name: '运河天地餐饮街', desc: '杭州市拱墅区小河路' },
      { name: '西溪印象城大酒楼', desc: '杭州市余杭区五常大道' },
      { name: '胜利河美食街', desc: '杭州市拱墅区霞湾巷' },
      { name: '武林广场商业区', desc: '杭州市拱墅区延安路' },
      { name: '滨江天街餐饮区', desc: '杭州市滨江区江汉路' }
    ],
    '重庆': [
      { name: '九街酒吧街', desc: '重庆市江北区观音桥洋河一路' },
      { name: '洪崖洞民俗酒店区', desc: '重庆市渝中区嘉陵江滨江路' },
      { name: '解放碑国宾大酒楼', desc: '重庆市渝中区民族路' },
      { name: '观音桥大融城餐吧', desc: '重庆市江北区建新北路' },
      { name: '江北城国金中心', desc: '重庆市江北区江北城西大街' },
      { name: '南滨路景观餐饮带', desc: '重庆市南岸区南滨路' },
      { name: '时代天街美食广场', desc: '重庆市渝中区长江二路' },
      { name: '磁器口大酒楼', desc: '重庆市沙坪坝区磁南街' }
    ],
    '西安': [
      { name: '德福巷酒吧街', desc: '西安市碑林区德福巷' },
      { name: '大唐不夜城大酒楼', desc: '西安市雁塔区慈恩路' },
      { name: '小寨赛格餐饮中心', desc: '西安市雁塔区长安中路' },
      { name: '南门合生汇餐吧', desc: '西安市碑林区环城南路' },
      { name: '钟楼开元广场', desc: '西安市碑林区东大街' },
      { name: '曲江池公园酒店区', desc: '西安市雁塔区曲江池东路' },
      { name: '高新万达广场', desc: '西安市雁塔区唐延路' },
      { name: '回民街大酒家', desc: '西安市莲湖区北院门' }
    ],
    '武汉': [
      { name: '江汉路步行街酒楼', desc: '武汉市江汉区江汉路' },
      { name: '光谷步行街酒吧区', desc: '武汉市洪山区光谷广场' },
      { name: '楚河汉街餐饮区', desc: '武汉市武昌区公正路' },
      { name: '武汉天地音乐餐吧', desc: '武汉市江岸区芦沟桥路' },
      { name: '花园道艺术餐饮街', desc: '武汉市江汉区青年路' },
      { name: '吉庆街大酒楼', desc: '武汉市江岸区中山大道' },
      { name: '国广中心大酒店', desc: '武汉市江汉区解放大道' },
      { name: '汉街万达广场', desc: '武汉市武昌区烟霞路' }
    ],
    '南京': [
      { name: '1912酒吧街区', desc: '南京市玄武区长江路' },
      { name: '新街口德基广场酒楼', desc: '南京市秦淮区中山东路' },
      { name: '夫子庙大酒楼', desc: '南京市秦淮区贡院街' },
      { name: '河西万达广场美食街', desc: '南京市建邺区江东中路' },
      { name: '百家湖1912街区', desc: '南京市江宁区双龙大道' },
      { name: '水游城餐饮中心', desc: '南京市秦淮区建康路' },
      { name: '紫峰大厦宴会厅', desc: '南京市鼓楼区中山北路' },
      { name: '老门东大酒家', desc: '南京市秦淮区剪子巷' }
    ],
    '郑州': [
      { name: '二七广场德化街', desc: '郑州市二七区德化街' },
      { name: '农科路酒吧街', desc: '郑州市金水区农科路' },
      { name: 'CBD玉米楼宴会厅', desc: '郑州市金水区商务内环路' },
      { name: '正弘城餐饮中心', desc: '郑州市金水区花园路' },
      { name: '国贸360广场餐吧', desc: '郑州市金水区农业路' },
      { name: '万达广场美食街', desc: '郑州市中原区中原中路' },
      { name: '海亮时代广场', desc: '郑州市管城区紫荆山路' },
      { name: '熙地港餐饮区', desc: '郑州市金水区农业东路' }
    ],
    '长沙': [
      { name: '解放西路酒吧街', desc: '长沙市芙蓉区解放西路' },
      { name: '坡子街火宫殿', desc: '长沙市天心区坡子街' },
      { name: '国金中心IFS大酒楼', desc: '长沙市芙蓉区黄兴中路' },
      { name: '太平街老酒楼', desc: '长沙市天心区太平街' },
      { name: '渔人码头餐饮街', desc: '长沙市岳麓区潇湘北路' },
      { name: '黄兴路步行街餐吧', desc: '长沙市天心区黄兴南路' },
      { name: '万达广场餐饮区', desc: '长沙市开福区湘江中路' },
      { name: '德思勤四季汇', desc: '长沙市雨花区湘府中路' }
    ]
  };

  if (cityMap[city]) {
    return cityMap[city];
  }

  return [
    { name: `${city}中心万达广场`, desc: `${city}市中心城区商业主街` },
    { name: `${city}万象城大酒楼`, desc: `${city}市商务核心区` },
    { name: `${city}酒吧风情街`, desc: `${city}市特色酒吧娱乐街区` },
    { name: `${city}国际大饭店宴会厅`, desc: `${city}市迎宾大道核心区` },
    { name: `${city}新天地餐饮广场`, desc: `${city}市高新区核心商圈` },
    { name: `${city}商业步行街大酒家`, desc: `${city}市老城区商业步行街` },
    { name: `${city}金鹰购物中心餐吧`, desc: `${city}市主干道商业区` },
    { name: `${city}温州商城酒店区`, desc: `${city}市繁华商业物流园区` }
  ];
}

// Helper to format order number as YC + YYYYMMDDHHMM + 5-digit sequence (e.g. YC20260802191300001)
const formatMerchantOrderNo = (data: any, idx?: number, totalCount?: number) => {
  if (data?.orderNo && data.orderNo.startsWith('YC') && data.orderNo.length >= 19) {
    return data.orderNo;
  }
  
  const ts = data?.timestamp || (data?.id && !isNaN(Number(String(data.id).replace('MO_', ''))) ? Number(String(data.id).replace('MO_', '')) : Date.now());
  const dt = new Date(ts);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');

  let seq = 1;
  if (data?.seqNumber) {
    seq = data.seqNumber;
  } else if (typeof idx === 'number' && typeof totalCount === 'number' && totalCount > 0) {
    seq = totalCount - idx;
  } else if (typeof idx === 'number') {
    seq = idx + 1;
  }

  const seqStr = String(seq).padStart(5, '0');
  return `YC${yyyy}${mm}${dd}${hh}${min}${seqStr}`;
};

interface MobileDispatchValetOrderProps {
  onShowToast: (msg: string) => void;
  userPhone?: string | null;
  userRole?: string;
  userTeamCity?: string;
  onClose?: () => void;
}

export default function MobileDispatchValetOrder({ 
  onShowToast,
  userPhone = null,
  userRole = '普通司机',
  userTeamCity = '',
  onClose
}: MobileDispatchValetOrderProps) {
  
  // Team management state (Default and fixed as requested)
  const teamName = '黑湾代驾小队';
  const setTeamName = (_name: string) => {};
  const tempTeamName = '黑湾代驾小队';
  const setTempTeamName = (_name: string) => {};
  const setIsEditingTeamName = (_editing: boolean) => {};

  // Network IP auto-detected current city state
  const [currentCity, setCurrentCity] = useState<string>(userTeamCity || '银川市');

  // Helper to auto-compress image and convert to PNG format
  const compressAndConvertToPng = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxWidth = 800;
            const maxHeight = 800;
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
              if (width / height > maxWidth / maxHeight) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(e.target?.result as string);
              return;
            }

            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            const pngUrl = canvas.toDataURL('image/png', 0.85);
            resolve(pngUrl);
          } catch (err) {
            resolve(e.target?.result as string);
          }
        };
        img.onerror = () => resolve(e.target?.result as string || '');
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // Ensure document title reflects 商户代叫系统
  useEffect(() => {
    document.title = '商户代叫系统';
  }, []);

  // Form states
  const [passengerAddress, setPassengerAddress] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [orderRemark, setOrderRemark] = useState('');
  const [scheduledTime, setScheduledTime] = useState('现在（立即出发）');
  const [needScooter, setNeedScooter] = useState(true);
  const [wechatQrUrl, setWechatQrUrl] = useState<string>('');

  // Modals & UI states
  const [isDispatchLoggedIn, setIsDispatchLoggedIn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dd_dispatch_logged_in') === 'true';
    } catch (_) {
      return false;
    }
  });

  // Login Form States
  const [loginPhone, setLoginPhone] = useState<string>(() => {
    return localStorage.getItem('dd_dispatch_user_phone') || '';
  });
  
  const activePhone = isDispatchLoggedIn && loginPhone ? loginPhone : (userPhone || '');

  // Real-time asynchronous parallel resolver for current dispatcher's WeChat QR code via Baota Server
  useEffect(() => {
    if (!activePhone) {
      setWechatQrUrl(MOCK_ALBUM_PHOTOS[0]?.dataUrl || '');
      return;
    }
    const userKey1 = `dd_dispatch_wechat_qr_${activePhone}`;
    const userKey2 = `dd_dispatch_fee_qr_${activePhone}`;
    const userKey3 = `dd_merchant_user_qr_${activePhone}`;

    // 1. Instant check local storage for zero-latency initial render
    const localSaved = safeGetItem(userKey1) || safeGetItem(userKey2) || safeGetItem(userKey3);
    if (localSaved) {
      setWechatQrUrl(localSaved);
    } else {
      setWechatQrUrl(MOCK_ALBUM_PHOTOS[0]?.dataUrl || ''); // Instant default fallback
    }

    // 2. Parallel background fetch from Baota Node DB API with silent auto-refresh
    let isMounted = true;
    const fetchBaotaQr = () => {
      const baseUrl = getBaseApiUrl();
      const timeToken = Date.now();
      const cols = ['dispatch_qrs', 'dispatch_qrcodes', 'merchant_users'];

      cols.forEach(colName => {
        fetch(`${baseUrl}/api/db/get?col=${colName}&id=${encodeURIComponent(activePhone)}&_t=${timeToken}`, { cache: 'no-store' })
          .then(res => res.ok ? res.json() : null)
          .then(json => {
            if (isMounted && json && json.data) {
              const qr = json.data.qrCode || json.data.wechatQrCode;
              if (qr) {
                setWechatQrUrl(prev => {
                  if (prev !== qr) {
                    safeSetItem(userKey1, qr);
                    safeSetItem(userKey2, qr);
                    return qr;
                  }
                  return prev;
                });
              }
            }
          })
          .catch(() => {});
      });
    };

    fetchBaotaQr();
    const intervalId = setInterval(fetchBaotaQr, 3000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [activePhone]);
  const [loginCode, setLoginCode] = useState<string>('');
  const [loginAgreement, setLoginAgreement] = useState<boolean>(true);
  const [codeCountdown, setCodeCountdown] = useState<number>(0);
  const [showLoginModalAgreement, setShowLoginModalAgreement] = useState<'user' | 'privacy' | null>(null);

  const [blockedDriverModal, setBlockedDriverModal] = useState<boolean>(false);
  const [isSendingCode, setIsSendingCode] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  useEffect(() => {
    let timer: any;
    if (codeCountdown > 0) {
      timer = setInterval(() => {
        setCodeCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [codeCountdown]);

  const handleSendLoginCode = async () => {
    const trimmedPhone = loginPhone.trim();
    if (!trimmedPhone || !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      onShowToast('❌ 请输入有效的11位手机号码！');
      return;
    }
    if (codeCountdown > 0 || isSendingCode) return;

    // Check if developer account (开发者账号 15509601222 允许登录)
    const isDeveloper = trimmedPhone === '15509601222';

    if (!isDeveloper) {
      // 1. Check if management team role (小队管理人员不允许登录，除了开发者15509601222)
      let isMgmtRole = false;
      if (typeof squadMembers !== 'undefined') {
        const sm = squadMembers.find((m: any) => m.phone === trimmedPhone);
        if (sm && ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'].includes(sm.role || sm.userRole)) {
          isMgmtRole = true;
        }
      }

      if (!isMgmtRole && db) {
        try {
          const dSnap = await getDoc(doc(db, 'driver_users', trimmedPhone));
          if (dSnap.exists()) {
            const role = dSnap.data()?.userRole || dSnap.data()?.role || '';
            if (['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'].includes(role)) {
              isMgmtRole = true;
            }
          }
          if (!isMgmtRole) {
            const sSnap = await getDoc(doc(db, 'squad_members', trimmedPhone));
            if (sSnap.exists()) {
              const role = sSnap.data()?.role || sSnap.data()?.userRole || '';
              if (['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'].includes(role)) {
                isMgmtRole = true;
              }
            }
          }
        } catch (_) {}
      }

      if (isMgmtRole) {
        onShowToast('❌ 小队管理人员不允许登录商户代叫系统（开发者账号15509601222除外）！');
        return;
      }

      // 2. Check if registered driver in App (司机在软件app里登录注册)
      let isRegisteredDriver = false;
      if (typeof realDrivers !== 'undefined' && realDrivers.some((d: any) => d.phone === trimmedPhone)) {
        isRegisteredDriver = true;
      }
      if (!isRegisteredDriver && typeof squadMembers !== 'undefined') {
        const sm = squadMembers.find((m: any) => m.phone === trimmedPhone);
        if (sm && (sm.role?.includes('司机') || sm.role === '普通司机' || sm.userRole?.includes('司机')) && !sm.role?.includes('商户') && !sm.role?.includes('商家')) {
          isRegisteredDriver = true;
        }
      }

      if (!isRegisteredDriver && db) {
        try {
          const dSnap = await getDoc(doc(db, 'driver_users', trimmedPhone));
          if (dSnap.exists()) {
            const role = dSnap.data()?.userRole || dSnap.data()?.role || '';
            if (role && role.includes('司机') && !role.includes('商户') && !role.includes('商家')) {
              isRegisteredDriver = true;
            }
          }
          if (!isRegisteredDriver) {
            const sSnap = await getDoc(doc(db, 'squad_members', trimmedPhone));
            if (sSnap.exists()) {
              const role = sSnap.data()?.role || sSnap.data()?.userRole || '';
              if (role && role.includes('司机') && !role.includes('商户') && !role.includes('商家')) {
                isRegisteredDriver = true;
              }
            }
          }
        } catch (_) {}
      }

      if (isRegisteredDriver) {
        setBlockedDriverModal(true);
        return;
      }
    }
    
    setIsSendingCode(true);
    onShowToast('🔄 正在请求阿里云发送短信验证码，请稍候...');

    try {
      const baseUrl = getBaseApiUrl();
      const res = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: trimmedPhone,
          scope: 'dispatch_valet'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCodeCountdown(60);
        onShowToast(data.message || `📱 验证码已成功发送至 ${trimmedPhone}，请注意查收短信！`);
      } else {
        onShowToast(data.error || '❌ 阿里云短信发送失败，请稍后重试！');
      }
    } catch (err: any) {
      onShowToast(`❌ 发送异常: ${err.message || '网络不稳定，请重试'}`);
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPhone = loginPhone.trim();
    if (!trimmedPhone || !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      onShowToast('❌ 请输入正确的11位手机号码！');
      return;
    }
    if (!loginCode.trim()) {
      onShowToast('❌ 请输入短信验证码！');
      return;
    }
    if (!loginAgreement) {
      onShowToast('❌ 请先勾选阅读并同意《用户服务协议》和《隐私政策》！');
      return;
    }

    if (isLoggingIn) return;
    setIsLoggingIn(true);

    try {
      const baseUrl = getBaseApiUrl();
      const res = await fetch(`${baseUrl}/api/sms/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: trimmedPhone,
          code: loginCode.trim(),
          scope: 'dispatch_valet'
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        onShowToast(data.error || '❌ 验证码错误或校验失败，请重试！');
        return;
      }

      const now = Date.now();
      const WHITELIST_PHONES = ['15509601222', '15121904440'];

      if (!WHITELIST_PHONES.includes(trimmedPhone)) {
        let phoneLogins: Record<string, number> = {};
        try {
          const saved = localStorage.getItem('dd_dispatch_phone_logins');
          if (saved) phoneLogins = JSON.parse(saved);
        } catch (_) {}

        let clientIp = '127.0.0.1';
        try {
          let storedIp = localStorage.getItem('dd_dispatch_client_ip');
          if (!storedIp) {
            storedIp = '114.242.25.' + Math.floor(Math.random() * 200 + 10);
            localStorage.setItem('dd_dispatch_client_ip', storedIp);
          }
          clientIp = storedIp;
        } catch (_) {}

        let ipLogins: Record<string, number> = {};
        try {
          const savedIp = localStorage.getItem('dd_dispatch_ip_logins');
          if (savedIp) ipLogins = JSON.parse(savedIp);
        } catch (_) {}

        phoneLogins[trimmedPhone] = now;
        ipLogins[clientIp] = now;

        try {
          localStorage.setItem('dd_dispatch_phone_logins', JSON.stringify(phoneLogins));
          localStorage.setItem('dd_dispatch_ip_logins', JSON.stringify(ipLogins));
        } catch (_) {}
      }

      // Auto-register merchant in merchant_users collection in Firestore & localStorage
      if (db && trimmedPhone) {
        try {
          await setDoc(doc(db, 'merchant_users', trimmedPhone), {
            phone: trimmedPhone,
            name: '商户、商家',
            role: '商户、商家',
            status: '已通过',
            approvedBy: '系统自动审批',
            approvedRole: '系统自动',
            createdAt: Date.now()
          }, { merge: true });
        } catch (e) {
          console.warn('Auto register merchant in Firestore failed:', e);
        }
      }

      try {
        localStorage.setItem('dd_dispatch_logged_in', 'true');
        localStorage.setItem('dd_dispatch_user_phone', trimmedPhone);
        localStorage.setItem('dd_user_phone', trimmedPhone);
        const savedMerchants = localStorage.getItem('dd_merchant_users_v2');
        let mList: any[] = savedMerchants ? JSON.parse(savedMerchants) : [];
        if (!mList.some((m: any) => m.phone === trimmedPhone)) {
          mList.push({ phone: trimmedPhone, name: '商户、商家', role: '商户、商家', status: '已通过', approvedBy: '系统自动审批' });
          localStorage.setItem('dd_merchant_users_v2', JSON.stringify(mList));
        }
      } catch (_) {}

      setIsDispatchLoggedIn(true);
      onShowToast(`🎉 欢迎登录商户代叫系统 (${trimmedPhone})！`);
    } catch (err: any) {
      onShowToast(`❌ 登录响应异常: ${err.message || '网络连接失败'}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogoutDispatch = () => {
    try {
      localStorage.setItem('dd_dispatch_logged_in', 'false');
    } catch (_) {}
    setIsDispatchLoggedIn(false);
    onShowToast('👋 已安全退出商户代叫系统！');
  };

  const [showTimePickerModal, setShowTimePickerModal] = useState(false);
  const [showBillingDetailModal, setShowBillingDetailModal] = useState(false);
  const [isDisclaimerAgreed, setIsDisclaimerAgreed] = useState(true);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [showOrderCenterModal, setShowOrderCenterModal] = useState(false);
  const [showTeamManagementModal, setShowTeamManagementModal] = useState(false);
  const [showApplicantApprovalModal, setShowApplicantApprovalModal] = useState(false);
  const [showConfirmClearOrdersModal, setShowConfirmClearOrdersModal] = useState(false);

  const handleExecuteClearAllOrders = async () => {
    setShowConfirmClearOrdersModal(false);
    // 1. Instantly reset local state in UI
    setAllDispatchedOrders([]);

    // 2. Clear backend collections
    try {
      await clearCollection('merchant_orders');
      await clearCollection('valet_orders');

      const allDocIds = new Set<string>();
      allDispatchedOrders.forEach((item: any) => {
        if (item?.id) allDocIds.add(String(item.id));
        if (item?.orderId) allDocIds.add(String(item.orderId));
      });

      if (db) {
        try {
          const snapshot = await getDocs(collection(db, 'merchant_orders'));
          snapshot.forEach((docSnap) => {
            if (docSnap?.id) allDocIds.add(String(docSnap.id));
          });
          const snapshotValet = await getDocs(collection(db, 'valet_orders'));
          snapshotValet.forEach((docSnap) => {
            if (docSnap?.id) allDocIds.add(String(docSnap.id));
          });
        } catch (e) {
          console.warn('getDocs error when clearing orders:', e);
        }
      }

      const deletePromises: Promise<void>[] = [];
      allDocIds.forEach((docId) => {
        deletePromises.push((async () => {
          try {
            await deleteDoc(doc(db, 'merchant_orders', docId));
            await deleteDoc(doc(db, 'valet_orders', docId));
          } catch (_) {}
        })());
      });
      await Promise.all(deletePromises);
    } catch (err) {
      console.warn('Error clearing merchant_orders collection:', err);
    }

    // 3. Wipe all local storage caches for orders
    try {
      localStorage.removeItem('dd_merchant_orders_v2');
      localStorage.removeItem('dd_merchant_orders');
      localStorage.removeItem('dd_active_orders');
      localStorage.removeItem('dd_passenger_links');
      localStorage.removeItem('dd_valet_orders');

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('mock_db_merchant_orders_') ||
          key.startsWith('mock_db_valet_orders_') ||
          key.startsWith('dd_merchant_order') ||
          key.startsWith('dd_driver_orders') ||
          key.startsWith('ord_') ||
          key.startsWith('valet_order')
        )) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) {}

    window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
    window.dispatchEvent(new CustomEvent('valet_orders_updated'));
    onShowToast('🧹 商户代叫订单中心所有订单已彻底一键清空！');
  };

  // Applicants for squad join approval (团队审核 - 申请审批)
  const [applicants, setApplicants] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('dd_applicants_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((a: any) => !['app-1', 'app-2', 'app-3'].includes(a.id));
        }
      }
    } catch (_) {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('dd_applicants_v2', JSON.stringify(applicants));
    } catch (_) {}
  }, [applicants]);

  // Realtime synchronization of squad applications across all devices via Baota Panel Cloud Database HTTP REST API
  useEffect(() => {
    let unsubApps = () => {};

    const fetchAppsHttp = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const map = new Map<string, any>();

        const resApps = await fetch(`${baseUrl}/api/db/list?col=squad_applications&_t=${Date.now()}`, { cache: 'no-store' });
        if (resApps.ok) {
          const jsonApps = await resApps.json();
          let rawApps: any[] = [];
          if (Array.isArray(jsonApps)) {
            rawApps = jsonApps.map((item: any) => (item?.data ? { id: item.id, phone: item.id, ...item.data } : item)).filter(Boolean);
          } else if (jsonApps && Array.isArray(jsonApps.docs)) {
            rawApps = jsonApps.docs.map((d: any) => (d ? { id: d.id, phone: d.id, ...(d.data || {}) } : null)).filter(Boolean);
          }
          rawApps.forEach((item: any) => {
            if (item && (item.phone || item.id)) {
              const key = item.phone || item.id;
              map.set(key, item);
            }
          });
        }

        const resMembers = await fetch(`${baseUrl}/api/db/list?col=squad_members&_t=${Date.now()}`, { cache: 'no-store' });
        if (resMembers.ok) {
          const jsonMembers = await resMembers.json();
          let rawMembers: any[] = [];
          if (Array.isArray(jsonMembers)) {
            rawMembers = jsonMembers.map((item: any) => (item?.data ? { id: item.id, phone: item.id, ...item.data } : item)).filter(Boolean);
          } else if (jsonMembers && Array.isArray(jsonMembers.docs)) {
            rawMembers = jsonMembers.docs.map((d: any) => (d ? { id: d.id, phone: d.id, ...(d.data || {}) } : null)).filter(Boolean);
          }
          rawMembers.forEach((item: any) => {
            if (item && (item.phone || item.id) && item.status === '待审核') {
              const key = item.phone || item.id;
              if (!map.has(key)) {
                map.set(key, {
                  id: item.id || `app-${key}`,
                  name: item.name || `司机${key.slice(-4)}`,
                  phone: key,
                  status: '待审核',
                  note: item.note || '申请加入小队！',
                  createdAt: item.createdAt || new Date().toLocaleString()
                });
              }
            }
          });
        }

        const mergedList = Array.from(map.values()).filter((a: any) => a && (a.phone || a.id) && !['app-1', 'app-2', 'app-3'].includes(a.id));
        if (mergedList.length > 0) {
          setApplicants(prev => {
            const combineMap = new Map<string, any>();
            (prev || []).forEach(item => {
              if (item && (item.phone || item.id)) {
                combineMap.set(item.phone || item.id, item);
              }
            });
            mergedList.forEach(item => {
              const key = item.phone || item.id;
              combineMap.set(key, { ...(combineMap.get(key) || {}), ...item });
            });
            return Array.from(combineMap.values()).filter((a: any) => !['app-1', 'app-2', 'app-3'].includes(a.id));
          });
        }
      } catch (_) {}
    };

    fetchAppsHttp();
    const appHttpInterval = setInterval(fetchAppsHttp, 3000);

    if (db) {
      unsubApps = onSnapshot(collection(db, 'squad_applications'), (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({
            id: docSnap.id,
            phone: docSnap.id,
            ...docSnap.data()
          });
        });
        if (list.length > 0) {
          setApplicants(prev => {
            const map = new Map<string, any>();
            prev.forEach(item => map.set(item.phone || item.id, item));
            list.forEach(item => {
              const key = item.phone || item.id;
              if (key) {
                map.set(key, { ...map.get(key), ...item });
              }
            });
            return Array.from(map.values()).filter((a: any) => !['app-1', 'app-2', 'app-3'].includes(a.id));
          });
        }
      });
    }

    return () => {
      clearInterval(appHttpInterval);
      unsubApps();
    };
  }, []);

  // Real-time synchronization of team name with Firestore city_configs & team_config
  useEffect(() => {
    const updateTeamNameFromConfigs = () => {
      const norm = (currentCity || '银川市').replace(/市$/, '').trim();
      const savedCityConfigs = localStorage.getItem('dd_city_configs_v2');
      if (savedCityConfigs) {
        try {
          const map = JSON.parse(savedCityConfigs);
          const cfg = map[norm] || map[`${norm}市`] || map[currentCity];
          if (cfg && Array.isArray(cfg.squadNames) && cfg.squadNames.length > 0) {
            setTeamName(cfg.squadNames[0]);
            setTempTeamName(cfg.squadNames[0]);
            localStorage.setItem('dd_dispatch_team_name', cfg.squadNames[0]);
            localStorage.setItem('dd_team_config_name', cfg.squadNames[0]);
            return;
          }
        } catch (e) {}
      }
      const savedTeamName = localStorage.getItem('dd_dispatch_team_name') || localStorage.getItem('dd_team_config_name');
      if (savedTeamName) {
        setTeamName(savedTeamName);
        setTempTeamName(savedTeamName);
      }
    };

    updateTeamNameFromConfigs();

    let unsubCity = () => {};
    let unsubTeam = () => {};

    if (db) {
      unsubCity = onSnapshot(doc(db, 'config', 'city_configs'), (snap) => {
        if (snap.exists() && snap.data().configs) {
          const configs = snap.data().configs;
          localStorage.setItem('dd_city_configs_v2', JSON.stringify(configs));
          const norm = (currentCity || '银川市').replace(/市$/, '').trim();
          const cfg = configs[norm] || configs[`${norm}市`] || configs[currentCity];
          if (cfg && Array.isArray(cfg.squadNames) && cfg.squadNames.length > 0) {
            setTeamName(cfg.squadNames[0]);
            setTempTeamName(cfg.squadNames[0]);
            localStorage.setItem('dd_dispatch_team_name', cfg.squadNames[0]);
            localStorage.setItem('dd_team_config_name', cfg.squadNames[0]);
          }
        }
      });

      unsubTeam = onSnapshot(doc(db, 'config', 'team_config'), (snap) => {
        if (snap.exists() && snap.data().teamName) {
          const name = snap.data().teamName;
          setTeamName(name);
          setTempTeamName(name);
          localStorage.setItem('dd_dispatch_team_name', name);
          localStorage.setItem('dd_team_config_name', name);
        }
      });
    }

    const handleTeamEvent = () => updateTeamNameFromConfigs();
    window.addEventListener('teamNameUpdated', handleTeamEvent);
    window.addEventListener('cityConfigsUpdated', handleTeamEvent);

    return () => {
      unsubCity();
      unsubTeam();
      window.removeEventListener('teamNameUpdated', handleTeamEvent);
      window.removeEventListener('cityConfigsUpdated', handleTeamEvent);
    };
  }, [currentCity]);

  const pendingApplicantCount = applicants.filter(a => a.status === '待审核').length;

  const handleApproveApplicant = (id: string, name: string) => {
    if (!canReviewApplicants) {
      onShowToast('⚠️ 您暂无审批权限，仅【开发者司机、城市老板司机、城市管理司机、城市派单员司机】可以审核');
      return;
    }

    const applicantObj = applicants.find(a => a.id === id);
    const targetPhone = applicantObj?.phone || '';
    const currentAdminName = (adminProfile.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机') ? adminProfile.name : '吴彦祖';
    const currentAdminRole = adminProfile.role || userRole || '开发者司机';

    // 1. Update applicants status
    setApplicants(prev => prev.map(a => a.id === id ? { 
      ...a, 
      status: '已通过',
      approvedBy: currentAdminName,
      approvedRole: currentAdminRole,
      approvalTime: new Date().toLocaleString()
    } : a));

    // 2. Instantly update squadMembers state ("秒自动更新到团队管理页面的全部成员列表里")
    setSquadMembers(prev => {
      const exists = prev.some(m => m.phone === targetPhone || m.id === id);
      if (exists) {
        return prev.map(m => (m.phone === targetPhone || m.id === id) ? {
          ...m,
          name,
          role: m.role || '普通司机',
          status: '已通过',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          note: applicantObj?.note || '',
          updatedAt: Date.now()
        } : m);
      }
      return [
        ...prev,
        {
          id: id || targetPhone,
          phone: targetPhone,
          name,
          role: '普通司机',
          status: '已通过',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          note: applicantObj?.note || '',
          city: userTeamCity || currentCity || '银川市',
          createdAt: Date.now()
        }
      ];
    });

    // 3. Save to Firestore & HTTP API Backend
    if (targetPhone) {
      if (db) {
        setDoc(doc(db, 'squad_applications', targetPhone), {
          status: '已通过',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          approvalTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});

        setDoc(doc(db, 'squad_members', targetPhone), {
          name,
          phone: targetPhone,
          role: '普通司机',
          status: '已通过',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          note: applicantObj?.note || '',
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});

        setDoc(doc(db, 'driver_users', targetPhone), {
          driverName: name,
          userRole: '普通司机',
          role: '普通司机',
          status: '已通过',
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});
      }

      const baseUrl = getBaseApiUrl();
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: 'squad_applications',
          docId: targetPhone,
          data: {
            status: '已通过',
            approvedBy: currentAdminName,
            approvedRole: currentAdminRole,
            approvalTime: new Date().toLocaleString()
          }
        })
      }).catch(() => {});
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: 'squad_members',
          docId: targetPhone,
          data: {
            name,
            phone: targetPhone,
            role: '普通司机',
            status: '已通过',
            approvedBy: currentAdminName,
            approvedRole: currentAdminRole,
            note: applicantObj?.note || '',
            lastUpdatedTime: new Date().toLocaleString()
          }
        })
      }).catch(() => {});
    }

    onShowToast(`🎉 【${currentAdminName} (${currentAdminRole})】已成功通过【${name}】的加入申请！`);
  };

  const handleRejectApplicant = (id: string, name: string) => {
    if (!canReviewApplicants) {
      onShowToast('⚠️ 您暂无审批权限，仅【开发者司机、城市老板司机、城市管理司机、城市派单员司机】可以审核');
      return;
    }

    const applicantObj = applicants.find(a => a.id === id);
    const targetPhone = applicantObj?.phone || '';
    const currentAdminName = (adminProfile.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机') ? adminProfile.name : '吴彦祖';
    const currentAdminRole = adminProfile.role || userRole || '开发者司机';

    // 1. Update applicants status
    setApplicants(prev => prev.map(a => a.id === id ? { 
      ...a, 
      status: '已拒绝',
      approvedBy: currentAdminName,
      approvedRole: currentAdminRole,
      approvalTime: new Date().toLocaleString()
    } : a));

    // 2. Instantly update squadMembers state
    setSquadMembers(prev => {
      const exists = prev.some(m => m.phone === targetPhone || m.id === id);
      if (exists) {
        return prev.map(m => (m.phone === targetPhone || m.id === id) ? {
          ...m,
          name,
          status: '已拒绝',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          rejectionReasons: applicantObj?.selectedReasons || [],
          updatedAt: Date.now()
        } : m);
      }
      return [
        ...prev,
        {
          id: id || targetPhone,
          phone: targetPhone,
          name,
          role: '普通司机',
          status: '已拒绝',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          note: applicantObj?.note || '',
          rejectionReasons: applicantObj?.selectedReasons || [],
          createdAt: Date.now()
        }
      ];
    });

    // 3. Save to Firestore & HTTP API
    if (targetPhone) {
      if (db) {
        setDoc(doc(db, 'squad_applications', targetPhone), {
          status: '已拒绝',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          rejectionReasons: applicantObj?.selectedReasons || [],
          approvalTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});

        setDoc(doc(db, 'squad_members', targetPhone), {
          name,
          phone: targetPhone,
          status: '已拒绝',
          approvedBy: currentAdminName,
          approvedRole: currentAdminRole,
          rejectionReasons: applicantObj?.selectedReasons || [],
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});
      }

      const baseUrl = getBaseApiUrl();
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: 'squad_applications',
          docId: targetPhone,
          data: {
            status: '已拒绝',
            approvedBy: currentAdminName,
            approvedRole: currentAdminRole,
            rejectionReasons: applicantObj?.selectedReasons || [],
            approvalTime: new Date().toLocaleString()
          }
        })
      }).catch(() => {});
    }

    onShowToast(`❌ 【${currentAdminName} (${currentAdminRole})】已拒绝【${name}】的加入申请`);
  };
  
  // Management Team Modal states
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberCategoryTab, setMemberCategoryTab] = useState<'全部' | '管理层' | '司机'>('全部');
  
  // Order Center filter states
  const [orderCenterTab, setOrderCenterTab] = useState<'全部' | '呼叫中' | '服务中' | '已完成' | '已取消'>('全部');
  const [filterYear, setFilterYear] = useState('2026');
  const [filterMonth, setFilterMonth] = useState('07');
  const [filterDay, setFilterDay] = useState('31');
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<any>(null);
  const [showCancelDispatchModal, setShowCancelDispatchModal] = useState(false);

  // Full-page Start Location Search state
  const [showStartLocationSearch, setShowStartLocationSearch] = useState(false);
  const [originSearchText, setOriginSearchText] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<any[]>([]);
  
  const [passengerCoords, setPassengerCoords] = useState<{ lat: number; lng: number }>({
    lat: 38.487167,
    lng: 106.23091
  });

  const amapContainerRef = useRef<HTMLDivElement | null>(null);
  const amapInstanceRef = useRef<any>(null);
  const amapMarkerRef = useRef<any>(null);
  const driverMarkersRef = useRef<any[]>([]);
  const [showAmapMap, setShowAmapMap] = useState<boolean>(false);
  
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [buttonState, setButtonState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [dispatchResult, setDispatchResult] = useState<any | null>(null);
  const [showCancelConfirmDialog, setShowCancelConfirmDialog] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  const handleConfirmCancelOrder = async () => {
    try {
      const targetId = activeOrderId || (allDispatchedOrders.length > 0 ? allDispatchedOrders[0].id : null);
      if (targetId) {
        // 1. Update Firestore merchant_orders
        try {
          await setDoc(doc(db, 'merchant_orders', targetId), {
            status: 'cancelled',
            in_hall: false,
            statusCategory: '已取消',
            cancelReason: '商户已手动取消代叫订单'
          }, { merge: true });
        } catch (e) {
          console.warn('Failed to update merchant_orders cancel status', e);
        }

        // 2. Update passenger_links if dispatched
        try {
          if (dispatchResult?.driver?.phone) {
            await setDoc(doc(db, 'passenger_links', dispatchResult.driver.phone), {
              status: 'cancelled',
              in_hall: false,
              cancelReason: '商户已手动取消代叫订单'
            }, { merge: true });
          }
        } catch (e) {}

        // 3. Clear from localStorage
        try {
          const savedLocal = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
          const updated = savedLocal.map((o: any) => {
            if (o.id === targetId || o.orderNo === targetId) {
              return { ...o, status: 'cancelled', in_hall: false, statusCategory: '已取消' };
            }
            return o;
          });
          localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
        } catch (_) {}
      }

      setDispatchResult(null);
      setActiveOrderId(null);
      setShowCancelConfirmDialog(false);
      if (onShowToast) {
        onShowToast('✓ 当前订单已成功取消，且不会在选单大厅里显示');
      }

      if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error('Cancel order error:', err);
      setShowCancelConfirmDialog(false);
      if (onClose) {
        onClose();
      }
    }
  };

  const handleConfirmCancelDispatch = async () => {
    setShowCancelDispatchModal(false);
    if (!selectedOrderDetail) return;

    const currentStatus = String(selectedOrderDetail.status || selectedOrderDetail.rawOrder?.status || '').toLowerCase();
    const currentCategory = String(selectedOrderDetail.statusCategory || selectedOrderDetail.rawOrder?.statusCategory || '');

    const isServingOrCompleted = 
      currentStatus === 'serving' || 
      currentStatus === 'completed' || 
      currentCategory === '服务中' || 
      currentCategory === '已完成';

    if (isServingOrCompleted) {
      const msg = '该订单服务中，无法取消派单。';
      if (onShowToast) {
        onShowToast(msg);
      } else {
        alert(msg);
      }
      return;
    }

    const targetOrderNo = selectedOrderDetail.orderNo || selectedOrderDetail.id || '此订单';
    const candidateIds = Array.from(new Set([
      selectedOrderDetail.id,
      selectedOrderDetail.orderId,
      selectedOrderDetail.rawOrder?.id,
      selectedOrderDetail.rawOrder?.orderId,
      selectedOrderDetail.orderNo,
      selectedOrderDetail.rawOrder?.orderNo,
      selectedOrderDetail.passengerPhone,
      selectedOrderDetail.rawOrder?.passengerPhone
    ].filter(Boolean)));

    const driverPhone = selectedOrderDetail.dispatchedDriverPhone || selectedOrderDetail.driverPhone || selectedOrderDetail.rawOrder?.driverPhone || selectedOrderDetail.rawOrder?.dispatchedDriverPhone;

    const baseUrl = getBaseApiUrl();

    // 1. Update Firestore & Node DB merchant_orders to cancelled
    for (const cid of candidateIds) {
      try {
        if (db) {
          await setDoc(doc(db, 'merchant_orders', cid as string), {
            in_hall: false,
            status: 'cancelled',
            statusCategory: '已取消',
            cancelledAt: Date.now(),
            cancelReason: '商户派单管理员取消派单'
          }, { merge: true });
        }
        fetch(`${baseUrl}/api/db/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'merchant_orders', docId: cid })
        }).catch(() => {});
      } catch (e) {
        console.error("Error setting merchant order to cancelled:", e);
      }
    }

    // 2. Clear from passenger_links & active_orders so driver App triggers cancellation toast "该订单已取消"
    if (driverPhone) {
      try {
        await deleteDoc(doc(db, 'passenger_links', driverPhone));
      } catch (_) {}
      try {
        await deleteDoc(doc(db, 'active_orders', driverPhone));
      } catch (_) {}
    }

    // Also write cancelled marker in active_orders for candidate IDs
    for (const cid of candidateIds) {
      try {
        if (db) {
          await setDoc(doc(db, 'active_orders', cid as string), {
            status: 'cancelled',
            statusCategory: '已取消',
            cancelledAt: Date.now()
          }, { merge: true });
        }
      } catch (_) {}
    }

    // 3. Clean and mark cancelled in local storage dd_merchant_orders_v2
    try {
      const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
      const updated = saved.map((o: any) => {
        const isMatch = candidateIds.some(cid =>
          o.id === cid ||
          o.orderId === cid ||
          o.orderNo === cid ||
          (o.passengerPhone && o.passengerPhone === cid)
        );
        if (isMatch) {
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
      localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
    } catch (_) {}

    // 4. Update local state & trigger event for immediate UI update
    setSelectedOrderDetail((prev: any) => prev ? {
      ...prev,
      in_hall: false,
      status: 'cancelled',
      statusCategory: '已取消'
    } : null);

    setAllDispatchedOrders((prev) => prev.map((o: any) => {
      const isMatch = candidateIds.some(cid =>
        o.id === cid ||
        o.orderId === cid ||
        o.orderNo === cid ||
        (o.passengerPhone && o.passengerPhone === cid)
      );
      if (isMatch) {
        return {
          ...o,
          in_hall: false,
          status: 'cancelled',
          statusCategory: '已取消'
        };
      }
      return o;
    }));

    window.dispatchEvent(new CustomEvent('merchant_orders_updated'));

    if (onShowToast) {
      onShowToast(`❌ 订单【${targetOrderNo}】已成功取消派单，且已同步从选单大厅及司机端清理`);
    }
  };
  
  // Real active drivers from Firestore
  const [realDrivers, setRealDrivers] = useState<any[]>([]);
  const [squadPhones, setSquadPhones] = useState<string[]>([]);
  const [squadMembers, setSquadMembers] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('dd_squad_members_v2');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });

  const [removedMemberPhones, setRemovedMemberPhones] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dd_removed_squad_phones_v2');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });

  const [merchantUsers, setMerchantUsers] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('dd_merchant_users_v2');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(collection(db, 'merchant_users'), (snap) => {
      const list: any[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      if (list.length > 0) {
        setMerchantUsers(list);
        try {
          localStorage.setItem('dd_merchant_users_v2', JSON.stringify(list));
        } catch (_) {}
      }
    }, (err) => console.warn('Error fetching merchant_users:', err));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (squadMembers && squadMembers.length > 0) {
      try {
        localStorage.setItem('dd_squad_members_v2', JSON.stringify(squadMembers));
      } catch (_) {}
    }
  }, [squadMembers]);
  const [adminProfile, setAdminProfile] = useState<{ name: string; avatar: string; role: string }>(() => {
    const savedName = localStorage.getItem('dd_admin_name') || localStorage.getItem('dd_user_name') || '吴彦祖';
    const cleanSavedName = (!savedName || savedName === '代驾司机' || savedName === '在线代驾司机') ? '吴彦祖' : savedName;
    return {
      name: cleanSavedName,
      avatar: driverAvatar,
      role: userRole || '开发者司机'
    };
  });

  const [isEditingAdminName, setIsEditingAdminName] = useState(false);
  const [tempAdminName, setTempAdminName] = useState('');

  // Check if user is a management team member: 开发者司机/开发者, 城市老板司机/城市老板, 城市管理司机/城市管理, 城市派单员司机/城市派单员
  const isManagementRole = Boolean(
    userPhone === '15509601222' || 
    userRole === '开发者司机' || 
    userRole === '开发者' || 
    userRole === '总指挥官' || 
    userRole === '城市老板司机' || 
    userRole === '城市老板' || 
    userRole === '城市管理司机' || 
    userRole === '城市管理' ||
    userRole === '城市派单员司机' ||
    userRole === '城市派单员' ||
    (adminProfile?.role && (
      adminProfile.role.includes('开发者') ||
      adminProfile.role.includes('老板') ||
      adminProfile.role.includes('管理') ||
      adminProfile.role.includes('指挥') ||
      adminProfile.role.includes('派单')
    ))
  );

  // Permission check for reviewing applicant join requests:
  // 开发者司机、城市老板司机、城市管理司机、城市派单员司机 均具备审核审批权限
  const canReviewApplicants = Boolean(
    userPhone === '15509601222' ||
    ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'].includes(userRole) ||
    ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(adminProfile.role)
  );

  // Member list inline editing states
  const [editingMemberPhone, setEditingMemberPhone] = useState<string | null>(null);
  const [editingMemberNameTemp, setEditingMemberNameTemp] = useState<string>('');

  // Helper to check allowed roles that current user can assign to target member
  const getAllowedAssignRoles = (targetMember: any) => {
    if (targetMember?.role === '商户、商家' || targetMember?.role?.includes('商户') || targetMember?.role?.includes('商家')) {
      return [];
    }
    const isDevOp = userPhone === '15509601222' || userRole === '开发者司机' || userRole === '开发者' || userRole === '总指挥官';
    const isBossOp = userRole === '城市老板司机' || userRole === '城市老板';
    const isManagerOp = userRole === '城市管理司机' || userRole === '城市管理';

    // 开发者司机 can assign any role in any city
    if (isDevOp) {
      return ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机', '商户、商家', '普通司机'];
    }

    const opCity = userTeamCity || currentCity || '银川市';
    const memberCity = targetMember.city || opCity;

    // City Boss & Manager can ONLY set drivers in their own city
    if (opCity && memberCity && opCity !== memberCity) {
      return [];
    }

    // 城市老板司机 can assign: 城市老板司机, 城市管理司机, 城市派单员司机, 普通司机 (cannot assign 开发者司机)
    if (isBossOp) {
      return ['城市老板司机', '城市管理司机', '城市派单员司机', '商户、商家', '普通司机'];
    }

    // 城市管理司机 can assign: 城市派单员司机, 普通司机
    if (isManagerOp) {
      return ['城市派单员司机', '商户、商家', '普通司机'];
    }

    // 城市派单员司机 & 普通司机 cannot assign roles
    return [];
  };

  // Save modified member name in member list (up to 8 Chinese characters)
  const handleSaveMemberName = async (targetPhone: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      onShowToast('⚠️ 成员名字不能为空');
      return;
    }

    const finalName = trimmed.slice(0, 8); // Max 8 Chinese characters

    // Sync adminProfile if editing self
    if (targetPhone === userPhone || targetPhone === '15509601222') {
      setAdminProfile(prev => ({ ...prev, name: finalName }));
      localStorage.setItem('dd_admin_name', finalName);
      localStorage.setItem('dd_user_name', finalName);
      if (userPhone) {
        localStorage.setItem(`dd_custom_app_name_${userPhone}`, finalName);
      }
    }

    // Update local React state immediately so UI updates without external database/network dependency
    setSquadMembers(prev => {
      const exists = prev.some(m => m.phone === targetPhone);
      if (exists) {
        return prev.map(m => m.phone === targetPhone ? { ...m, name: finalName, driverName: finalName } : m);
      }
      return [...prev, { phone: targetPhone, name: finalName, driverName: finalName }];
    });

    // Also sync to applicants list if present
    setApplicants(prev => prev.map(a => (a.phone === targetPhone || a.id === targetPhone) ? { ...a, name: finalName } : a));

    try {
      if (targetPhone) {
        setDoc(doc(db, 'squad_members', targetPhone), {
          name: finalName,
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});

        setDoc(doc(db, 'driver_users', targetPhone), {
          driverName: finalName,
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});
      }
    } catch (_) {}

    onShowToast(`🎉 已成功将成员名字修改为：「${finalName}」！`);
    setEditingMemberPhone(null);
  };

  // Update member role in member list
  const handleUpdateMemberRole = async (targetMember: any, newRole: string) => {
    const allowed = getAllowedAssignRoles(targetMember);
    if (!allowed.includes(newRole)) {
      onShowToast(`❌ 权限不足：您无权将角色设置为【${newRole}】`);
      return;
    }

    // Update local React state immediately so UI updates without external database/network dependency
    setSquadMembers(prev => {
      const exists = prev.some(m => m.phone === targetMember.phone);
      if (exists) {
        return prev.map(m => m.phone === targetMember.phone ? { ...m, role: newRole, userRole: newRole } : m);
      }
      return [...prev, { ...targetMember, role: newRole, userRole: newRole }];
    });

    // Also sync to applicants list if present
    setApplicants(prev => prev.map(a => (a.phone === targetMember.phone || a.id === targetMember.id) ? { ...a, role: newRole } : a));

    try {
      if (targetMember.phone) {
        setDoc(doc(db, 'squad_members', targetMember.phone), {
          role: newRole,
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});

        setDoc(doc(db, 'driver_users', targetMember.phone), {
          userRole: newRole,
          role: newRole,
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});
      }
    } catch (_) {}

    onShowToast(`🎉 已成功将【${targetMember.name}】的角色修改为：${newRole}`);
  };

  const handleSaveAdminName = async () => {
    const trimmed = tempAdminName.trim();
    if (!trimmed) {
      onShowToast('⚠️ 管理员名字不能为空');
      return;
    }

    const finalName = trimmed.slice(0, 8); // Max 8 Chinese characters

    setAdminProfile(prev => ({ ...prev, name: finalName }));
    localStorage.setItem('dd_admin_name', finalName);
    localStorage.setItem('dd_user_name', finalName);

    if (userPhone) {
      try {
        setDoc(doc(db, 'driver_users', userPhone), {
          driverName: finalName,
          lastUpdatedTime: new Date().toLocaleString()
        }, { merge: true }).catch(() => {});

        setDoc(doc(db, 'squad_members', userPhone), {
          name: finalName
        }, { merge: true }).catch(() => {});
      } catch (err) {
        console.error('Failed to update admin name:', err);
      }
    }

    setIsEditingAdminName(false);
    onShowToast(`🎉 已成功修改名字为：「${finalName}」！`);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Real-time listener for all dispatched orders
  const [allDispatchedOrders, setAllDispatchedOrders] = useState<any[]>([]);

  useEffect(() => {
    const syncOrders = (snapshotDocs?: any[]) => {
      const list: any[] = [];
      if (snapshotDocs) {
        snapshotDocs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data) {
            const isCancelled = data.status === 'cancelled' || data.statusCategory === '已取消' || data.statusCategory === '订单已取消';
            list.push({
              id: docSnap.id,
              orderId: docSnap.id,
              ...data,
              statusCategory: isCancelled ? '已取消' : (data.statusCategory || (data.status === 'hall' ? '呼叫中' : data.status === 'completed' ? '已完成' : '服务中'))
            });
          }
        });
      }

      // Merge local storage dd_merchant_orders_v2 for local fallback (including both real and virtual orders)
      try {
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        saved.forEach((item: any) => {
          if (!item) return;
          const isItemCancelled = item.status === 'cancelled' || item.statusCategory === '已取消' || item.statusCategory === '订单已取消';
          const matchIdx = list.findIndex(x => (x.id && (x.id === item.id || x.id === item.orderId)) || (x.orderNo && item.orderNo && x.orderNo === item.orderNo));
          if (matchIdx !== -1) {
            if (isItemCancelled) {
              list[matchIdx].status = 'cancelled';
              list[matchIdx].statusCategory = '已取消';
              list[matchIdx].in_hall = false;
            }
          } else {
            list.push({
              id: item.id || item.orderId,
              orderId: item.id || item.orderId,
              ...item,
              status: isItemCancelled ? 'cancelled' : item.status,
              statusCategory: isItemCancelled ? '已取消' : (item.statusCategory || (item.status === 'hall' ? '呼叫中' : '服务中'))
            });
          }
        });
      } catch (_) {}

      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      const totalCount = list.length;
      list.forEach((item, idx) => {
        item.orderNo = formatMerchantOrderNo(item, idx, totalCount);
      });
      setAllDispatchedOrders(list);
    };

    const unsubscribe = onSnapshot(collection(db, 'merchant_orders'), (snapshot) => {
      syncOrders(snapshot.docs);
    });

    const handleOrdersUpdated = () => {
      syncOrders();
    };

    window.addEventListener('merchant_orders_updated', handleOrdersUpdated);

    return () => {
      unsubscribe();
      window.removeEventListener('merchant_orders_updated', handleOrdersUpdated);
    };
  }, []);

  // Keep selectedOrderDetail synced with allDispatchedOrders in real-time
  useEffect(() => {
    if (selectedOrderDetail && allDispatchedOrders.length > 0) {
      const updated = allDispatchedOrders.find(
        (o: any) =>
          (o.id && (o.id === selectedOrderDetail.id || o.id === selectedOrderDetail.orderId)) ||
          (o.orderNo && selectedOrderDetail.orderNo && o.orderNo === selectedOrderDetail.orderNo)
      );
      if (updated) {
        setSelectedOrderDetail((prev: any) => ({ ...prev, ...updated }));
      }
    }
  }, [allDispatchedOrders]);

  // Fetch real drivers & current user profile
  useEffect(() => {
    const fetchFromHttp = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/db/list?col=driver_users`);
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.docs) && json.docs.length > 0) {
            const list = json.docs
              .filter((d: any) => d && d.data && !d.data.isBanned)
              .map((d: any) => {
                const data = d.data;
                const dName = (data.driverName && data.driverName !== '代驾司机' && data.driverName !== '在线代驾司机') ? data.driverName : (data.name && data.name !== '代驾司机' && data.name !== '在线代驾司机') ? data.name : '吴彦祖';
                return {
                  phone: d.id,
                  name: dName,
                  lat: data.lat,
                  lng: data.lng,
                  drivingYears: data.drivingYears || 5,
                  isOnline: data.isOnline === true || data.isOnline === 'true' || data.onlineOrdersEnabled === true || data.onlineOrdersEnabled === 'true',
                  isBusy: data.isBusy === true || data.isBusy === 'true',
                  role: data.role || data.userRole || '',
                  onlineOrdersEnabled: data.onlineOrdersEnabled === true || data.onlineOrdersEnabled === 'true',
                  lastUpdatedTime: data.lastUpdatedTime || '',
                  version: data.version || data.appVersion || 'V2.0'
                };
              });
            if (list.length > 0) {
              setRealDrivers(prev => {
                const map = new Map();
                prev.forEach(item => map.set(item.phone, item));
                list.forEach(item => map.set(item.phone, { ...map.get(item.phone), ...item }));
                return Array.from(map.values());
              });
            }
          }
        }
      } catch (_) {}
    };

    fetchFromHttp();
    const httpInterval = setInterval(fetchFromHttp, 5000);

    const unsubscribe = onSnapshot(collection(db, 'driver_users'), (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.isBanned) return;
        
        const dName = (data.driverName && data.driverName !== '代驾司机' && data.driverName !== '在线代驾司机') ? data.driverName : (data.name && data.name !== '代驾司机' && data.name !== '在线代驾司机') ? data.name : '吴彦祖';

        list.push({
          phone: docSnap.id,
          name: dName,
          lat: data.lat,
          lng: data.lng,
          drivingYears: data.drivingYears || 5,
          isOnline: data.isOnline === true || data.isOnline === 'true' || data.onlineOrdersEnabled === true || data.onlineOrdersEnabled === 'true',
          isBusy: data.isBusy === true || data.isBusy === 'true',
          role: data.role || data.userRole || '',
          onlineOrdersEnabled: data.onlineOrdersEnabled === true || data.onlineOrdersEnabled === 'true',
          lastUpdatedTime: data.lastUpdatedTime || '',
          version: data.version || data.appVersion || 'V2.0'
        });

        if (userPhone && docSnap.id === userPhone) {
          if (data.driverName && data.driverName !== '代驾司机' && data.driverName !== '在线代驾司机') {
            setAdminProfile(prev => ({
              ...prev,
              name: data.driverName,
              avatar: data.avatarUrl || prev.avatar
            }));
          }
        }
      });
      setRealDrivers(list);
    });
    return () => {
      clearInterval(httpInterval);
      unsubscribe();
    };
  }, [userPhone]);

  // Fetch squad members to filter "进入小队的"
  useEffect(() => {
    const fetchSquadFromHttp = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/db/list?col=squad_members`);
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.docs) && json.docs.length > 0) {
            const phones: string[] = [];
            const list = json.docs.map((d: any) => {
              phones.push(d.id);
              return {
                phone: d.id,
                ...d.data
              };
            });
            setSquadPhones(phones);
            setSquadMembers(list);
          }
        }
      } catch (_) {}
    };

    fetchSquadFromHttp();
    const squadHttpInterval = setInterval(fetchSquadFromHttp, 5000);

    const unsubscribe = onSnapshot(collection(db, 'squad_members'), (snapshot) => {
      const phones: string[] = [];
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        phones.push(docSnap.id);
        list.push({
          phone: docSnap.id,
          ...docSnap.data()
        });

        if (userPhone && docSnap.id === userPhone) {
          const mData = docSnap.data();
          if (mData.name && mData.name !== '代驾司机' && mData.name !== '在线代驾司机') {
            setAdminProfile(prev => ({ ...prev, name: mData.name }));
          }
        }
      });
      setSquadPhones(phones);
      setSquadMembers(list);
    });
    return () => {
      clearInterval(squadHttpInterval);
      unsubscribe();
    };
  }, [userPhone]);

  // Requirement 1: 中国大陆每个城市，商户代叫，获得审批成功加入小队的司机（包括管理团队人员），每20秒自动上传一次当前位置
  useEffect(() => {
    if (!userPhone) return;

    const isManagementRole = [
      '开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机', '总指挥官', '开发者'
    ].includes(adminProfile?.role || userRole || '');

    const isApprovedMember = squadMembers.some((m: any) => 
      m.phone === userPhone && ['已通过', 'approved', '通过'].includes(m.status || m.approvalStatus)
    ) || squadPhones.includes(userPhone);

    if (!isManagementRole && !isApprovedMember) return;

    const reportLocation = () => {
      const localIsOnline = typeof window !== 'undefined' ? localStorage.getItem('dd_is_online') === 'true' : false;
      if (!localIsOnline) return;

      const doReport = (lat: number, lng: number) => {
        const timeStr = new Date().toLocaleString();
        const locData = {
          driverName: (adminProfile?.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机') ? adminProfile.name : '吴彦祖',
          phone: userPhone,
          lat,
          lng,
          city: currentCity || '银川市',
          isOnline: true,
          onlineOrdersEnabled: true,
          userRole: adminProfile?.role || userRole || '普通司机',
          lastUpdatedTime: timeStr,
          lastLocationTime: Date.now()
        };

        if (db) {
          setDoc(doc(db, 'driver_users', userPhone), locData, { merge: true }).catch(() => {});
          setDoc(doc(db, 'squad_members', userPhone), {
            lat,
            lng,
            city: currentCity || '银川市',
            lastLocationTime: Date.now(),
            lastUpdatedTime: timeStr
          }, { merge: true }).catch(() => {});
        }

        // Realtime report location and online status to Aliyun server API
        const baseUrl = getBaseApiUrl();
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'driver_users', docId: userPhone, data: locData })
        }).catch(() => {});
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: 'squad_members',
            docId: userPhone,
            data: {
              lat,
              lng,
              city: currentCity || '银川市',
              lastLocationTime: Date.now(),
              lastUpdatedTime: timeStr
            }
          })
        }).catch(() => {});

        try {
          localStorage.setItem(`dd_driver_loc_${userPhone}`, JSON.stringify(locData));
        } catch (_) {}
      };

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => doReport(pos.coords.latitude, pos.coords.longitude),
          () => doReport(passengerCoords.lat, passengerCoords.lng),
          { enableHighAccuracy: true, timeout: 6000 }
        );
      } else {
        doReport(passengerCoords.lat, passengerCoords.lng);
      }
    };

    reportLocation();
    const intervalId = setInterval(reportLocation, 20000); // 20秒自动上传一次当前位置
    return () => clearInterval(intervalId);
  }, [userPhone, squadMembers, squadPhones, adminProfile, userRole, currentCity, passengerCoords]);

  // Requirement 4: 选单大厅里20分钟没有司机接单则自动取消订单
  useEffect(() => {
    const check20MinHallTimeout = async () => {
      const now = Date.now();
      const TIMEOUT_20_MIN = 20 * 60 * 1000; // 20分钟 = 1,200,000毫秒

      setAllDispatchedOrders(prevOrders => {
        let changed = false;
        const updatedList = prevOrders.map(ord => {
          const isHallOrder = ord.status === 'hall' || ord.statusCategory === '呼叫中' || ord.status === 'submitted';
          const isNotFinal = ord.status !== 'cancelled' && ord.status !== 'completed' && ord.status !== 'claimed';
          const orderAge = ord.timestamp ? (now - ord.timestamp) : 0;

          if (isHallOrder && isNotFinal && orderAge >= TIMEOUT_20_MIN) {
            changed = true;
            const cancelledData = {
              ...ord,
              status: 'cancelled',
              statusCategory: '已取消',
              cancelReason: '选单大厅20分钟无人接单，系统自动取消',
              cancelledAt: now
            };

            if (db && ord.id) {
              setDoc(doc(db, 'merchant_orders', ord.id), {
                status: 'cancelled',
                statusCategory: '已取消',
                cancelReason: '选单大厅20分钟无人接单，系统自动取消',
                cancelledAt: now
              }, { merge: true }).catch(() => {});
            }

            return cancelledData;
          }
          return ord;
        });

        if (changed) {
          try {
            const localSaved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
            const updatedSaved = localSaved.map((item: any) => {
              const isHallOrder = item.status === 'hall' || item.statusCategory === '呼叫中';
              const orderAge = item.timestamp ? (now - item.timestamp) : 0;
              if (isHallOrder && item.status !== 'cancelled' && orderAge >= TIMEOUT_20_MIN) {
                return {
                  ...item,
                  status: 'cancelled',
                  statusCategory: '已取消',
                  cancelReason: '选单大厅20分钟无人接单，系统自动取消'
                };
              }
              return item;
            });
            localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updatedSaved));
            window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
          } catch (_) {}
        }

        return updatedList;
      });
    };

    check20MinHallTimeout();
    const timer = setInterval(check20MinHallTimeout, 10000); // 每10秒检查一次
    return () => clearInterval(timer);
  }, []);

  // Helper to calculate member ID: developer default 888888, first management member 000001, subsequent squad members 000002, 000003, etc.
  const getSquadMemberId = (phone: string | null) => {
    // 1. Developer ID is fixed at 888888 for phone 15509601222 or developer role
    if (phone === '15509601222' || userRole === '开发者' || userRole === '总指挥官') {
      return '888888';
    }

    if (!phone) return '000001';

    // 2. Filter out developer from squadMembers list
    const nonDevMembers = squadMembers.filter(m => m.phone !== '15509601222' && m.role !== '开发者' && m.role !== '总指挥官');

    // Sort squadMembers by join time ascending
    const sorted = [...nonDevMembers].sort((a, b) => {
      const getTs = (m: any) => {
        const val = m.addedAt || m.joinedAt || m.timestamp || m.createdAt || m.joinTime;
        if (!val) return 0;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const parsed = Date.parse(val);
          return isNaN(parsed) ? 0 : parsed;
        }
        if (val.seconds) return val.seconds * 1000;
        return 0;
      };
      return getTs(a) - getTs(b);
    });

    const index = sorted.findIndex(m => m.phone === phone);
    if (index >= 0) {
      return String(index + 1).padStart(6, '0');
    }

    // Fallback if current user is not yet recorded in squad_members array
    if (nonDevMembers.length > 0) {
      return String(nonDevMembers.length + 1).padStart(6, '0');
    }

    return '000001';
  };

  // Auto-detect driver network IP city location via AMap / IP API
  useEffect(() => {
    let isMounted = true;

    const detectCityByIp = () => {
      const AMap = (window as any).AMap;
      if (AMap && AMap.plugin) {
        AMap.plugin('AMap.CitySearch', () => {
          const citySearch = new AMap.CitySearch();
          citySearch.getLocalCity((status: string, result: any) => {
            if (isMounted && status === 'complete' && result && result.city) {
              setCurrentCity(result.city);
            }
          });
        });
      }
    };

    detectCityByIp();
    const timer = setTimeout(detectCityByIp, 800);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  // GPS Precise Location handler (triggers geolocation and reverse geocodes address name)
  const [isLocatingGPS, setIsLocatingGPS] = useState(false);

  const handleFetchGPSLocation = (silent: boolean = false) => {
    setIsLocatingGPS(true);

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setPassengerCoords({ lat, lng });

          const AMap = (window as any).AMap;
          if (AMap) {
            AMap.plugin(['AMap.Geocoder', 'AMap.convertFrom'], () => {
              AMap.convertFrom([lng, lat], 'gps', (status: string, result: any) => {
                const searchLng = (status === 'complete' && result?.locations?.[0]) ? result.locations[0].lng : lng;
                const searchLat = (status === 'complete' && result?.locations?.[0]) ? result.locations[0].lat : lat;
                
                setPassengerCoords({ lat: searchLat, lng: searchLng });

                const geocoder = new AMap.Geocoder({ city: currentCity || '银川市' });
                geocoder.getAddress([searchLng, searchLat], (geoStatus: string, geoResult: any) => {
                  setIsLocatingGPS(false);
                  if (geoStatus === 'complete' && geoResult?.regeocode?.formattedAddress) {
                    const formatted = geoResult.regeocode.formattedAddress;
                    setPassengerAddress(formatted);
                  }
                });
              });
            });
          } else {
            setIsLocatingGPS(false);
          }
        },
        (error) => {
          console.warn('GPS location permission denied or failed:', error);
          setIsLocatingGPS(false);
          
          const AMap = (window as any).AMap;
          const applyFallback = () => {
            const fallbackLat = 38.4830;
            const fallbackLng = 106.2350;
            setPassengerCoords({ lat: fallbackLat, lng: fallbackLng });
            setPassengerAddress(prev => (prev && prev !== '正在获取当前位置...' && prev !== '定位中...') ? prev : '银川市运祥小区');
            if (!silent) {
              onShowToast('📍 已自动定位至银川城区推荐中心点');
            }
          };

          if (AMap) {
            AMap.plugin('AMap.Geolocation', () => {
              const geolocation = new AMap.Geolocation({
                enableHighAccuracy: true,
                timeout: 3000,
                noIpLocate: 0
              });
              geolocation.getCurrentPosition((status: string, result: any) => {
                if (status === 'complete' && result?.formattedAddress) {
                  setPassengerAddress(result.formattedAddress);
                  if (result.position) {
                    setPassengerCoords({ lat: result.position.lat, lng: result.position.lng });
                  }
                  if (!silent) {
                    onShowToast(`📍 高精度定位成功：${result.formattedAddress}`);
                  }
                } else {
                  applyFallback();
                }
              });
            });
          } else {
            applyFallback();
          }
        },
        { enableHighAccuracy: true, timeout: 3500, maximumAge: 300000 }
      );
    } else {
      setIsLocatingGPS(false);
      const fallbackLat = 38.4830;
      const fallbackLng = 106.2350;
      setPassengerCoords({ lat: fallbackLat, lng: fallbackLng });
      setPassengerAddress(prev => (prev && prev !== '正在获取当前位置...' && prev !== '定位中...') ? prev : '银川市运祥小区');
      if (!silent) {
        onShowToast('📍 已自动定位至银川城区推荐中心点');
      }
    }
  };

  // Trigger GPS positioning automatically on webpage / component load (silent mode)
  useEffect(() => {
    handleFetchGPSLocation(true);
  }, []);

  // Dynamically load AMap JS API for AutoComplete support
  useEffect(() => {
    let script = document.getElementById('amap-js-api-v2') as HTMLScriptElement || document.querySelector('script[src*="webapi.amap.com"]');

    if (!(window as any).AMap && !script) {
      script = document.createElement('script');
      script.id = 'amap-js-api-v2';
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=4143e567d55bbc1855231f9637efd6b0';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  // Initialize and synchronize 高德地图 (AMap) instance
  useEffect(() => {
    if (!amapContainerRef.current) return;

    let isMounted = true;

    const initOrUpdateMap = () => {
      const AMap = (window as any).AMap;
      if (!AMap || !amapContainerRef.current) return;

      try {
        if (!amapInstanceRef.current) {
          const map = new AMap.Map(amapContainerRef.current, {
            center: [passengerCoords.lng, passengerCoords.lat],
            zoom: 16,
            viewMode: '2D',
            pitch: 0,
            rotateEnable: false,
            pitchEnable: false,
            resizeEnable: true
          });

          amapInstanceRef.current = map;

          // Click map to select location
          map.on('click', (e: any) => {
            const lng = e.lnglat.getLng();
            const lat = e.lnglat.getLat();
            setPassengerCoords({ lat, lng });

            // Reverse Geocode
            AMap.plugin('AMap.Geocoder', () => {
              const geocoder = new AMap.Geocoder();
              geocoder.getAddress([lng, lat], (status: string, result: any) => {
                if (status === 'complete' && result.regeocode) {
                  const addr = result.regeocode.formattedAddress;
                  if (addr) setPassengerAddress(addr);
                }
              });
            });
          });
        } else {
          amapInstanceRef.current.setCenter([passengerCoords.lng, passengerCoords.lat]);
        }

        const map = amapInstanceRef.current;

        // Pickup point marker
        if (!amapMarkerRef.current) {
          const marker = new AMap.Marker({
            position: [passengerCoords.lng, passengerCoords.lat],
            title: passengerAddress || '代驾商家起点',
            anchor: 'bottom-center'
          });
          marker.setMap(map);
          amapMarkerRef.current = marker;
        } else {
          amapMarkerRef.current.setPosition([passengerCoords.lng, passengerCoords.lat]);
          amapMarkerRef.current.setTitle(passengerAddress || '代驾商家起点');
        }

        // Render nearby driver markers
        driverMarkersRef.current.forEach((m) => m.setMap(null));
        driverMarkersRef.current = [];

        const candidateDrivers = getCombinedDrivers();
        if (candidateDrivers && candidateDrivers.length > 0) {
          candidateDrivers.filter(d => (d.distance || 0) <= 5).forEach((d: any) => {
            if (d.lng && d.lat) {
              const driverMarker = new AMap.Marker({
                position: [d.lng, d.lat],
                title: `${d.name || '司机'} (${d.distance || 0}km)`,
                anchor: 'center',
                content: `<div style="padding: 2px 6px; background: #ff7d00; color: #ffffff; font-size: 10px; font-weight: bold; border-radius: 10px; border: 1px solid #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.2); white-space: nowrap;">🚗 ${d.name || '司机'}</div>`
              });
              driverMarker.setMap(map);
              driverMarkersRef.current.push(driverMarker);
            }
          });
        }
      } catch (err) {
        console.warn("AMap init error:", err);
      }
    };

    if ((window as any).AMap) {
      initOrUpdateMap();
    } else {
      const timer = setInterval(() => {
        if ((window as any).AMap) {
          clearInterval(timer);
          if (isMounted) initOrUpdateMap();
        }
      }, 300);
      return () => clearInterval(timer);
    }

    return () => {
      isMounted = false;
    };
  }, [showAmapMap, passengerCoords.lat, passengerCoords.lng]);

  // Suggestions search on address change
  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!AMap || !passengerAddress.trim() || !showSuggestions) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      AMap.plugin('AMap.AutoComplete', () => {
        const auto = new AMap.AutoComplete({
          city: userTeamCity || '银川市',
          citylimit: true
        });
        auto.search(passengerAddress, (status: string, result: any) => {
          if (status === 'complete' && result.tips) {
            setSuggestions(result.tips.filter((t: any) => t.location && t.name));
          } else {
            setSuggestions([]);
          }
        });
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [passengerAddress, userTeamCity, showSuggestions]);

  // Suggestions search on originSearchText change for full page modal
  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!AMap || !originSearchText.trim() || !showStartLocationSearch) {
      setOriginSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      AMap.plugin('AMap.AutoComplete', () => {
        const auto = new AMap.AutoComplete({
          city: userTeamCity || '银川市',
          citylimit: false
        });
        auto.search(originSearchText, (status: string, result: any) => {
          if (status === 'complete' && result.tips) {
            setOriginSuggestions(result.tips.filter((t: any) => t.name));
          } else {
            setOriginSuggestions([]);
          }
        });
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [originSearchText, userTeamCity, showStartLocationSearch]);

  // Handle Team Name Change
  const handleSaveTeamName = () => {
    if (!tempTeamName.trim()) return;
    const newName = tempTeamName.trim();
    setTeamName(newName);
    localStorage.setItem('dd_dispatch_team_name', newName);
    localStorage.setItem('dd_team_config_name', newName);

    // Also update city_configs for currentCity
    const norm = (currentCity || '银川市').replace(/市$/, '').trim();
    const saved = localStorage.getItem('dd_city_configs_v2');
    let cityMap: Record<string, any> = {};
    if (saved) {
      try { cityMap = JSON.parse(saved); } catch(e){}
    }
    const currCityCfg = cityMap[norm] || {
      online_app_enabled: false,
      merchant_dispatch_enabled: false,
      squad_management_enabled: false,
      squadNames: []
    };
    const updatedNames = Array.isArray(currCityCfg.squadNames) && currCityCfg.squadNames.length > 0
      ? [newName, ...currCityCfg.squadNames.filter((s: string) => s !== newName)]
      : [newName];
    cityMap[norm] = {
      ...currCityCfg,
      squadNames: updatedNames
    };
    localStorage.setItem('dd_city_configs_v2', JSON.stringify(cityMap));

    window.dispatchEvent(new Event('teamNameUpdated'));
    window.dispatchEvent(new CustomEvent('cityConfigsUpdated', { detail: cityMap }));

    if (db) {
      setDoc(doc(db, 'config', 'team_config'), {
        teamName: newName,
        updatedAt: new Date().toISOString(),
        setBy: userPhone || '管理员'
      }, { merge: true }).catch(() => {});

      setDoc(doc(db, 'config', 'city_configs'), {
        configs: cityMap
      }, { merge: true }).catch(() => {});
    }
    setIsEditingTeamName(false);
    onShowToast('✓ 已更新小队名称');
  };

    // Handle Image Upload for Payment QR with Auto-compression & PNG conversion
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!activePhone || !activePhone.trim()) {
      onShowToast('❌ 请先登录商户手机号码后再上传微信代叫费收款码！');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('图片大小不能超过 10MB');
      return;
    }

    try {
      const pngDataUrl = await compressAndConvertToPng(file);
      
      // Upload to Aliyun Server (Baota)
      try {
        const baseUrl = getBaseApiUrl();
        const uploadRes = await fetch(`${baseUrl}/api/upload-wechat-qr`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ phone: activePhone, imageBase64: pngDataUrl })
        });

        let uploadData: any = null;
        if (uploadRes.ok && uploadRes.headers.get('content-type')?.includes('application/json')) {
          uploadData = await uploadRes.json();
        } else {
          const text = await uploadRes.text();
          console.warn('Aliyun QR upload returned non-JSON response:', uploadRes.status, text.slice(0, 100));
        }

        if (uploadData && uploadData.success && uploadData.url) {
          setWechatQrUrl(uploadData.url);
          const userKey = `dd_dispatch_wechat_qr_${activePhone}`;
          localStorage.setItem(userKey, uploadData.url);

          // Save to Baota Node DB for Mainland China server
          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              col: 'dispatch_qrs',
              id: activePhone,
              data: {
                qrCode: uploadData.url,
                dispatchedByPhone: activePhone,
                updatedAt: new Date().toISOString()
              }
            })
          }).catch(() => {});

          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              col: 'dispatch_qrcodes',
              id: activePhone,
              data: {
                qrCode: uploadData.url,
                dispatchedByPhone: activePhone,
                updatedAt: new Date().toISOString()
              }
            })
          }).catch(() => {});

          if (db) {
            try {
              await setDoc(doc(db, 'dispatch_qrs', activePhone), {
                qrCode: uploadData.url,
                dispatchedByPhone: activePhone,
                updatedAt: new Date().toISOString()
              }, { merge: true });
              await setDoc(doc(db, 'dispatch_qrcodes', activePhone), {
                qrCode: uploadData.url,
                dispatchedByPhone: activePhone,
                updatedAt: new Date().toISOString()
              }, { merge: true });
            } catch (_) {}
          }
          onShowToast('✓ 代叫费微信收款码已保存（格式PNG）');
          return;
        }
      } catch (uploadErr) {
        console.warn('Failed to upload QR to Aliyun server, falling back to local storage:', uploadErr);
        // Fallback to storing base64 if upload fails
      }

      // Fallback
      setWechatQrUrl(pngDataUrl);
      const userKey = `dd_dispatch_wechat_qr_${activePhone}`;
      localStorage.setItem(userKey, pngDataUrl);

      const baseUrl = getBaseApiUrl();
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          col: 'dispatch_qrs',
          id: activePhone,
          data: {
            qrCode: pngDataUrl,
            dispatchedByPhone: activePhone,
            updatedAt: new Date().toISOString()
          }
        })
      }).catch(() => {});

      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          col: 'dispatch_qrcodes',
          id: activePhone,
          data: {
            qrCode: pngDataUrl,
            dispatchedByPhone: activePhone,
            updatedAt: new Date().toISOString()
          }
        })
      }).catch(() => {});

      if (db) {
        try {
          await setDoc(doc(db, 'dispatch_qrs', activePhone), {
            qrCode: pngDataUrl,
            dispatchedByPhone: activePhone,
            updatedAt: new Date().toISOString()
          }, { merge: true });
          await setDoc(doc(db, 'dispatch_qrcodes', activePhone), {
            qrCode: pngDataUrl,
            dispatchedByPhone: activePhone,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (_) {}
      }
      onShowToast('✓ 代叫费微信收款码已保存（格式PNG）');
    } catch (err) {
      console.error('Failed to compress QR image:', err);
      alert('图片处理失败，请重试');
    }
  };

  // Combine real drivers (Only real squad drivers)
  const getCombinedDrivers = () => {
    const driverMap = new Map<string, any>();

    // 1. Add realDrivers who are online
    realDrivers.forEach(d => {
      if (d.phone && (d.isOnline === true || d.isOnline === 'true' || d.onlineOrdersEnabled === true || d.onlineOrdersEnabled === 'true')) {
        driverMap.set(d.phone, { ...d, isOnline: true });
      }
    });

    // 2. Add squadMembers who are online
    squadMembers.forEach((sm: any) => {
      if (sm.phone && (sm.isOnline === true || sm.isOnline === 'true' || sm.onlineOrdersEnabled === true || sm.onlineOrdersEnabled === 'true')) {
        const existing = driverMap.get(sm.phone) || {};
        const st = sm.status || sm.approvalStatus || '已通过';
        if (!['已拒绝', 'rejected', '拒绝'].includes(st)) {
          driverMap.set(sm.phone, {
            ...existing,
            phone: sm.phone,
            name: sm.name || sm.driverName || sm.realName || existing.name || `司机${sm.phone.slice(-4)}`,
            lat: isValidCoords(sm.lat, sm.lng) ? sm.lat : existing.lat,
            lng: isValidCoords(sm.lat, sm.lng) ? sm.lng : existing.lng,
            isOnline: true,
            isBusy: sm.isBusy === true || existing.isBusy === true,
            role: sm.role || sm.approvedRole || existing.role || ''
          });
        }
      }
    });

    // 3. Ensure developer admin driver 15509601222 is ALWAYS present if online
    const localIsOnline = typeof window !== 'undefined' ? localStorage.getItem('dd_is_online') === 'true' : false;
    if (userPhone && userPhone === '15509601222') {
      if (localIsOnline) {
        const latStr = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lat') : null;
        const lngStr = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lng') : null;
        const selfLat = latStr ? parseFloat(latStr) : passengerCoords.lat;
        const selfLng = lngStr ? parseFloat(lngStr) : passengerCoords.lng;

        const existing = driverMap.get('15509601222') || {};
        driverMap.set('15509601222', {
          ...existing,
          phone: '15509601222',
          name: adminProfile?.name || existing.name || '开发者司机',
          lat: isValidCoords(selfLat, selfLng) ? selfLat : (isValidCoords(existing.lat, existing.lng) ? existing.lat : passengerCoords.lat),
          lng: isValidCoords(selfLat, selfLng) ? selfLng : (isValidCoords(existing.lat, existing.lng) ? existing.lng : passengerCoords.lng),
          isOnline: true,
          isBusy: existing.isBusy === true,
          onlineOrdersEnabled: true,
          role: '开发者司机'
        });
      }
    }

    // 4. Ensure currently logged-in driver status is derived strictly from localIsOnline
    if (userPhone && userPhone !== '15509601222') {
      if (localIsOnline) {
        const latStr = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lat') : null;
        const lngStr = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lng') : null;
        const smSelf = squadMembers.find((m: any) => m.phone === userPhone);
        const selfRealName = smSelf?.name || smSelf?.driverName || smSelf?.realName || (adminProfile?.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机' && adminProfile.name !== '吴彦祖' ? adminProfile.name : `司机${userPhone.slice(-4)}`);

        const selfLat = latStr ? parseFloat(latStr) : passengerCoords.lat;
        const selfLng = lngStr ? parseFloat(lngStr) : passengerCoords.lng;

        const existing = driverMap.get(userPhone) || {};
        driverMap.set(userPhone, {
          ...existing,
          phone: userPhone,
          name: selfRealName,
          lat: isValidCoords(selfLat, selfLng) ? selfLat : existing.lat,
          lng: isValidCoords(selfLat, selfLng) ? selfLng : existing.lng,
          isOnline: true,
          isBusy: existing.isBusy === true,
          onlineOrdersEnabled: true,
          role: adminProfile?.role || existing.role || '开发者司机'
        });
      } else {
        // Driver is offline, remove from candidate dispatch map!
        driverMap.delete(userPhone);
      }
    }

    const onlineRealDrivers = Array.from(driverMap.values());

    const listWithDistance = onlineRealDrivers.map(d => {
      const sm = squadMembers.find((m: any) => m.phone === d.phone);
      const realName = sm?.name || sm?.driverName || sm?.realName || (d.name && d.name !== '吴彦祖' && d.name !== '代驾司机' && d.name !== '在线代驾司机' ? d.name : null);
      const cleanName = realName || (d.phone ? `小队司机(${d.phone.slice(-4)})` : '小队司机');

      let dLat = d.lat;
      let dLng = d.lng;

      if (!isValidCoords(dLat, dLng) && sm && isValidCoords(sm.lat, sm.lng)) {
        dLat = sm.lat;
        dLng = sm.lng;
      }

      const dist = (isValidCoords(dLat, dLng) && isValidCoords(passengerCoords.lat, passengerCoords.lng))
        ? calculateDistance(passengerCoords.lat, passengerCoords.lng, dLat, dLng)
        : 999;

      return {
        ...d,
        name: cleanName,
        lat: dLat,
        lng: dLng,
        distance: dist
      };
    });

    listWithDistance.sort((a, b) => a.distance - b.distance);
    return listWithDistance;
  };

  const driversList = getCombinedDrivers();
  const closestDriver = driversList[0];

  // One-Key Dispatch Handler (3km Radius & Order Selection Hall logic)
  const handleOneKeyDispatch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!passengerAddress.trim() || !passengerPhone.trim()) {
      onShowToast('❌ 请先完整填写代驾商家起点和乘客手机号码！');
      return;
    }

    if (!isDisclaimerAgreed) {
      onShowToast('❌ 请先勾选并同意《代叫代驾服务特别免责条款》！');
      return;
    }

    setIsDispatching(true);
    setButtonState('processing');
    setDispatchResult(null);

    // Safety fallback timer: guarantee state reset after 4s max so UI can never freeze!
    const safetyTimer = setTimeout(() => {
      setIsDispatching(false);
      setButtonState(prev => prev === 'processing' ? 'idle' : prev);
    }, 4000);

    try {
      const finalPhone = passengerPhone.trim() || '未填写 (匿名代开单)';
      const ts = Date.now();
      const dt = new Date(ts);
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const min = String(dt.getMinutes()).padStart(2, '0');

      const dateKey = `${yyyy}${mm}${dd}`;
      const storageKey = `dd_merchant_order_seq_${dateKey}`;
      let seq = 1;
      try {
        const savedSeq = parseInt(safeGetItem(storageKey) || '0', 10);
        seq = savedSeq + 1;
        safeSetItem(storageKey, String(seq));
      } catch (_) {}

      const seqStr = String(seq).padStart(5, '0');
      const formattedOrderNo = `YC${yyyy}${mm}${dd}${hh}${min}${seqStr}`;
      const orderId = 'MO_' + ts;

      // Helper to verify driver eligibility for orders
      const isDriverEligible = (d: any) => {
        const phone = d.phone ? String(d.phone).trim() : '';
        if (!phone) return false;

        if (d.isBusy === true || d.isBusy === 'true') return false;

        const isOnline = d.isOnline === true || d.isOnline === 'true' || d.onlineOrdersEnabled === true || d.onlineOrdersEnabled === 'true' ||
          (userPhone && phone === userPhone && typeof window !== 'undefined' && safeGetItem('dd_is_online') === 'true');
        if (!isOnline) return false;

        const mgmtRoles = [
          '开发者司机', '开发者', '总指挥官',
          '城市老板司机', '城市老板',
          '城市管理司机', '城市管理',
          '城市派单员司机', '城市派单员'
        ];

        const dRole = (d.role || d.userRole || d.approvedRole || '').trim();

        let removedList: string[] = typeof removedMemberPhones !== 'undefined' ? removedMemberPhones : [];
        try {
          const savedRemoved = safeGetItem('dd_removed_squad_phones_v2');
          if (savedRemoved) {
            const parsed = JSON.parse(savedRemoved);
            if (Array.isArray(parsed)) {
              removedList = Array.from(new Set([...removedList, ...parsed]));
            }
          }
        } catch (_) {}

        const isRemoved = removedList.some(p => String(p).trim() === phone || String(p).trim() === String(d.id || '').trim() || String(p).trim() === String(d.name || '').trim());
        if (isRemoved) return false;

        const testMerchantPhones = ['15509601222', '15121904440', '18695119126'];
        const isTestPhone = testMerchantPhones.includes(phone);

        if (!isTestPhone) {
          const isPureMerchant = (dRole.includes('商户') || dRole.includes('商家')) && !dRole.includes('司机') && !dRole.includes('管理');
          if (isPureMerchant) return false;
        }

        const sm = squadMembers.find((m: any) => String(m.phone).trim() === phone || String(m.id).trim() === phone);
        const isInSquad = isTestPhone || Boolean(sm) || squadPhones.includes(phone);

        if (!isInSquad) {
          return false;
        }

        if (sm && !isTestPhone) {
          const st = sm.status || sm.approvalStatus || '已通过';
          if (['已拒绝', 'rejected', '拒绝'].includes(st)) {
            return false;
          }
          const smRole = (sm.role || sm.approvedRole || sm.userRole || '').trim();
          const smIsPureMerchant = (smRole.includes('商户') || smRole.includes('商家')) && !smRole.includes('司机') && !smRole.includes('管理');
          if (smIsPureMerchant) {
            return false;
          }
        }

        return true;
      };

      const geocodedStart = geocodeAddress(passengerAddress);
      const isDefaultCoords = (
        !passengerCoords ||
        (Math.abs(passengerCoords.lat - 38.487167) < 0.0001 && Math.abs(passengerCoords.lng - 106.23091) < 0.0001) ||
        (Math.abs(passengerCoords.lat - 38.487193) < 0.0001 && Math.abs(passengerCoords.lng - 106.230912) < 0.0001)
      );
      const finalLat = (!isDefaultCoords && isValidCoords(passengerCoords.lat, passengerCoords.lng))
        ? passengerCoords.lat
        : geocodedStart.lat;
      const finalLng = (!isDefaultCoords && isValidCoords(passengerCoords.lat, passengerCoords.lng))
        ? passengerCoords.lng
        : geocodedStart.lng;

      // Recalculate distance for all online drivers using exact finalLat & finalLng
      const allCandidateDrivers = getCombinedDrivers().map(d => {
        let dLat = d.lat;
        let dLng = d.lng;
        if (!isValidCoords(dLat, dLng)) {
          const sm = squadMembers.find((m: any) => String(m.phone).trim() === String(d.phone).trim());
          if (sm && isValidCoords(sm.lat, sm.lng)) {
            dLat = sm.lat;
            dLng = sm.lng;
          }
        }
        const dist = (isValidCoords(dLat, dLng) && isValidCoords(finalLat, finalLng))
          ? calculateDistance(finalLat, finalLng, dLat, dLng)
          : 999;
        return { ...d, lat: dLat, lng: dLng, distance: dist };
      });

      // Find online free drivers who are eligible
      const eligibleDrivers = allCandidateDrivers.filter(d => {
        const isFree = !d.isBusy && d.isBusy !== 'true';
        const isEligible = isDriverEligible(d);
        return isFree && isEligible;
      });

      // Filter drivers within 3km (3000m)
      const driversWithin3km = eligibleDrivers.filter(d => {
        const distMeters = (d.distance || 0) * 1000;
        return distMeters <= 3000;
      });

      let chosenDriver: any = null;

      if (driversWithin3km.length > 0) {
        const minDist = Math.min(...driversWithin3km.map(d => d.distance || 0));
        const closestTied = driversWithin3km.filter(d => Math.abs((d.distance || 0) - minDist) < 0.001);
        chosenDriver = closestTied[Math.floor(Math.random() * closestTied.length)];
      }

      const finalScheduledTime = (scheduledTime && scheduledTime.trim() !== '' && scheduledTime !== '现在出发')
        ? scheduledTime.trim()
        : '现在（立即出发）';
      const finalNeedScooter = needScooter !== false;

      const phoneLast4 = activePhone && activePhone.length >= 4 ? activePhone.slice(-4) : '5552';
      const isRealPerson = adminProfile?.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机' && adminProfile.name !== '吴彦祖' && !adminProfile.name.startsWith('网页商户商家');
      const merchantDispatcherName = isRealPerson ? adminProfile.name : `商户商家${phoneLast4}`;
      const mgmtRoles = ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'];
      let currentAdminRole = '商户、商家';
      if (activePhone !== '15121904440') {
        if (adminProfile?.role && mgmtRoles.includes(adminProfile.role)) {
          currentAdminRole = adminProfile.role;
        } else if (userRole && mgmtRoles.includes(userRole)) {
          currentAdminRole = userRole;
        }
      }

      const effectiveQr = wechatQrUrl || MOCK_ALBUM_PHOTOS[0]?.dataUrl || '';

      const newOrderData = {
        id: orderId,
        orderNo: formattedOrderNo,
        seqNumber: seq,
        passengerPhone: finalPhone,
        startLocation: passengerAddress,
        passengerLat: finalLat,
        passengerLng: finalLng,
        approxPrice: '未知',
        calculatedTotalFee: 40.00,
        estimatedPrice: '40.00',
        price: '¥40.00',
        orderRemark: orderRemark.trim() || '商户代叫',
        needScooter: finalNeedScooter,
        scheduledTime: finalScheduledTime,
        bookingTime: finalScheduledTime,
        paymentQrCode: effectiveQr,
        dispatchedByPhone: activePhone || '',
        adminPhone: activePhone || '',
        adminName: merchantDispatcherName,
        dispatchedByName: merchantDispatcherName,
        adminRole: currentAdminRole,
        dispatcherRole: currentAdminRole,
        teamName: teamName,
        timestamp: ts,
        isValetOrder: true,
        isPlatformDispatch: true,
        status: chosenDriver ? 'dispatched' : 'hall',
        in_hall: chosenDriver ? false : true,
        statusCategory: chosenDriver ? '已指派' : '呼叫中',
        dispatchedDriverPhone: chosenDriver ? chosenDriver.phone : ''
      };

      // Save active order ID
      setActiveOrderId(orderId);

      // 1. Instant local persistence & UI update
      try {
        const savedLocal = JSON.parse(safeGetItem('dd_merchant_orders_v2') || '[]');
        savedLocal.unshift(newOrderData);
        safeSetItem('dd_merchant_orders_v2', JSON.stringify(savedLocal.slice(0, 50)));
      } catch (_) {}

      window.dispatchEvent(new CustomEvent('merchant_orders_updated'));

      if (activePhone && (chosenDriver?.phone === activePhone || chosenDriver?.phone === userPhone || chosenDriver?.phone === '15509601222')) {
        const passengerLinkPayload = { ...newOrderData, status: 'submitted', orderId };
        window.dispatchEvent(new CustomEvent('trigger_incoming_order', { detail: passengerLinkPayload }));
      }

      // 2. Non-blocking background sync with 2.5s max timeout
      const syncRemote = async () => {
        const baseUrl = getBaseApiUrl();
        try {
          await Promise.race([
            setDoc(doc(db, 'merchant_orders', orderId), newOrderData),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500))
          ]);
        } catch (_) {}

        try {
          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'merchant_orders', docId: orderId, data: newOrderData })
          }).catch(() => {});
        } catch (_) {}

        if (chosenDriver) {
          const passengerLinkPayload = { ...newOrderData, status: 'submitted', orderId };
          try {
            await Promise.race([
              setDoc(doc(db, 'passenger_links', chosenDriver.phone), passengerLinkPayload),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500))
            ]);
          } catch (_) {}
          try {
            fetch(`${baseUrl}/api/db/set`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection: 'passenger_links', docId: chosenDriver.phone, data: passengerLinkPayload })
            }).catch(() => {});
          } catch (_) {}
        }
      };
      syncRemote();

      // 3. Update UI state to success immediately
      clearTimeout(safetyTimer);
      setIsDispatching(false);
      setButtonState('success');
      setDispatchResult({
        driver: chosenDriver || { name: '选单大厅 (开放抢单)' },
        passengerPhone: finalPhone,
        startLocation: passengerAddress,
        distance: chosenDriver ? chosenDriver.distance : 0
      });

      onShowToast('订单已发送');

      setTimeout(() => {
        setButtonState('idle');
      }, 2500);

    } catch (err: any) {
      clearTimeout(safetyTimer);
      setIsDispatching(false);
      setButtonState('idle');
      onShowToast('❌ 下单发生异常：' + (err?.message || '请重试'));
    }
  };

  const currentQrUrl = wechatQrUrl;

  // Render Login View if user is not logged in to merchant dispatch system
  if (!isDispatchLoggedIn) {
    return (
      <div className="bg-[#f9f9f9] text-[#1a1c1c] min-h-screen flex flex-col relative overflow-hidden select-none">
        {/* Background Grid Pattern */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-40" 
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(0, 0, 0, 0.04) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0, 0, 0, 0.04) 1px, transparent 1px)
            `,
            backgroundSize: '20px 20px'
          }}
        />

        {/* Top Close Button if onClose present */}
        {onClose && (
          <div className="absolute top-3 left-3 z-50">
            <button 
              type="button"
              onClick={onClose}
              className="text-[#584235] hover:opacity-80 p-2 rounded-full flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Main Content Canvas */}
        <main className="flex-1 flex flex-col px-5 pb-8 z-10 relative max-w-md mx-auto w-full justify-center my-auto">
          {/* Brand Header Area */}
          <div className="mt-6 mb-6 flex flex-col items-center w-full text-center">
            <h1 className="text-2xl font-extrabold text-[#1a1c1c] tracking-tight flex items-center justify-center gap-2">
              <span>商户代叫</span>
            </h1>
          </div>

          {/* Login Form Container */}
          <div className="bg-white rounded-2xl border border-[#dfc0af]/60 shadow-[0_4px_16px_rgba(0,0,0,0.03)] p-6 mb-8 w-full relative">
            <form onSubmit={handleLoginSubmit} className="flex flex-col gap-3 w-full">
              {/* Mobile Number Field */}
              <div className="flex flex-col relative w-full">
                <label className="sr-only">手机号码</label>
                <div className="flex w-full items-center border border-[#e2dfde] rounded-xl bg-[#f9f9f9] focus-within:border-[#ff7d00] focus-within:ring-2 focus-within:ring-[#ff7d00]/20 transition-all">
                  <div className="pl-4 pr-3 py-3 border-r border-[#e2dfde] flex items-center gap-1 cursor-pointer select-none">
                    <span className="text-sm font-semibold text-[#1a1c1c]">+86</span>
                    <ChevronDown className="w-4 h-4 text-[#5f5e5e]" />
                  </div>
                  <input 
                    type="tel"
                    maxLength={11}
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="请输入手机号码" 
                    className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm text-[#1a1c1c] px-4 py-3 w-full"
                  />
                </div>
              </div>

              {/* Verification Code Field */}
              <div className="flex flex-col relative w-full mt-1">
                <label className="sr-only">验证码</label>
                <div className="flex w-full items-center border border-[#e2dfde] rounded-xl bg-[#f9f9f9] focus-within:border-[#ff7d00] focus-within:ring-2 focus-within:ring-[#ff7d00]/20 transition-all">
                  <input 
                    type="text"
                    maxLength={6}
                    value={loginCode}
                    onChange={(e) => setLoginCode(e.target.value)}
                    placeholder="请输入验证码" 
                    className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm text-[#1a1c1c] pl-4 py-3 w-full"
                  />
                  <button 
                    type="button"
                    onClick={handleSendLoginCode}
                    disabled={codeCountdown > 0}
                    className="pr-4 pl-3 py-3 text-xs font-bold text-[#ff7d00] hover:opacity-80 disabled:text-gray-400 transition-opacity whitespace-nowrap cursor-pointer"
                  >
                    {codeCountdown > 0 ? `${codeCountdown}s 后重发` : '获取验证码'}
                  </button>
                </div>
              </div>

              {/* Remember Me & Agreements */}
              <div className="flex items-start gap-2.5 mt-3 mb-1 w-full">
                <div className="flex items-center h-5 mt-0.5">
                  <input 
                    id="agreement" 
                    type="checkbox"
                    checked={loginAgreement}
                    onChange={(e) => setLoginAgreement(e.target.checked)}
                    className="w-4 h-4 text-[#ff7d00] bg-[#f9f9f9] border-[#8b7263] rounded focus:ring-[#ff7d00] accent-[#ff7d00] cursor-pointer"
                  />
                </div>
                <label htmlFor="agreement" className="text-xs text-[#5f5e5e] leading-snug cursor-pointer select-none">
                  我已阅读并同意{' '}
                  <button
                    type="button"
                    onClick={() => setShowLoginModalAgreement('user')}
                    className="text-[#ff7d00] font-semibold hover:underline cursor-pointer"
                  >
                    《用户服务协议》
                  </button>
                  和{' '}
                  <button
                    type="button"
                    onClick={() => setShowLoginModalAgreement('privacy')}
                    className="text-[#ff7d00] font-semibold hover:underline cursor-pointer"
                  >
                    《隐私政策》
                  </button>
                  <span className="block mt-0.5 text-[11px] text-gray-400">勾选保持登录状态</span>
                </label>
              </div>

              {/* Submit Action */}
              <button 
                type="submit"
                className="w-full mt-2 bg-[#ff7d00] active:bg-[#e06d00] text-white py-3.5 rounded-xl font-bold text-sm shadow-[0_4px_12px_rgba(255,125,0,0.25)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>登录 / 注册</span>
                <ArrowRight className="w-4 h-4 text-white" />
              </button>
            </form>
          </div>

          {/* User Service Agreement / Privacy Policy Modals */}
          
      {/* Intercepted Registered Driver Modal Dialog */}
      {blockedDriverModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center shadow-xl border border-gray-100 flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-xl">
              ⚠️
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-gray-900">提示</h3>
              <p className="text-sm text-gray-700 font-medium pt-1">
                您已注册为代驾司机，无法登录。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBlockedDriverModal(false)}
              className="w-full py-2.5 bg-[#ff7d00] hover:bg-[#e06d00] text-white font-bold text-sm rounded-xl transition-colors shadow-xs cursor-pointer"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {showLoginModalAgreement && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-sm rounded-2xl p-5 max-h-[80vh] flex flex-col shadow-2xl space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2 shrink-0">
                  <h3 className="font-bold text-sm text-[#1a1c1c]">
                    {showLoginModalAgreement === 'user' ? '《用户服务协议》' : '《隐私政策》'}
                  </h3>
                  <button 
                    type="button" 
                    onClick={() => setShowLoginModalAgreement(null)}
                    className="p-1 text-gray-400 hover:text-gray-600 rounded-full"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto text-xs text-gray-600 space-y-2 leading-relaxed">
                  {showLoginModalAgreement === 'user' ? (
                    <>
                      <p className="font-semibold text-gray-800">一、服务须知</p>
                      <p>黑湾代驾商户代叫系统为合作商家提供快捷代叫与订单匹配管理功能。用户须如实填写真实联系信息并遵守平台安全运营规范。</p>
                      <p className="font-semibold text-gray-800">二、用户账号与安全</p>
                      <p>用户手机号码与验证码为系统登录凭证，请妥善保管个人账号及短信动态码，防止信息泄露。</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-gray-800">一、信息收集与使用</p>
                      <p>本系统仅收集提供代驾居间服务所必需的手机号码、行程起点定位等基础数据，用于派单与司机定位接驾。</p>
                      <p className="font-semibold text-gray-800">二、数据安全保护</p>
                      <p>平台采用行业标准的加密传输与防越权隐私保护机制，严格保障商户与乘客的个人信息安全。</p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowLoginModalAgreement(null)}
                  className="w-full py-2 bg-[#ff7d00] text-white rounded-xl text-xs font-bold shrink-0 cursor-pointer"
                >
                  我知道了
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-[#f9f9f9] text-[#1a1c1c] font-sans relative flex flex-col select-text">
      
      {/* Hidden File Input for QR Code */}
      <input 
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        className="hidden"
      />

      {/* TopAppBar */}
      <header className="sticky top-0 w-full z-40 bg-[#f9f9f9] border-b border-[#e2e2e2] flex items-center justify-between px-3 sm:px-5 h-14 shadow-sm shrink-0 relative">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleLogoutDispatch}
            className="px-2 py-1 rounded-lg text-xs font-semibold text-[#584235] hover:bg-black/5 flex items-center gap-1 border border-gray-200/80 cursor-pointer transition-all active:scale-95"
            title="退出当前登录"
          >
            <LogOut className="w-3.5 h-3.5 text-[#ff7d00]" />
            <span>退出当前登录</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button 
            type="button"
            onClick={() => {
              if (onClose) {
                onClose();
              } else {
                try {
                  window.close();
                } catch (_) {}
              }
            }} 
            className="px-2 py-1 rounded-lg text-xs font-semibold text-[#584235] hover:bg-black/5 flex items-center gap-1 border border-gray-200/80 cursor-pointer transition-all active:scale-95 shrink-0"
            title="点击关闭本页面"
            aria-label="点击关闭本页面"
          >
            <span>点击关闭本页面</span>
            <X className="w-4 h-4 text-[#ff7d00]" />
          </button>
        </div>
      </header>

      {/* Main Form Content */}
      <main className="max-w-xl mx-auto pt-4 px-5 space-y-5 flex-1 w-full pb-8">
        
        {/* Section: Booking Form (商户代叫下单信息) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-[#1a1c1c] flex items-center gap-1.5">
              <Car className="w-5 h-5 text-[#984800] fill-[#ff7d00]/20" />
              <span>商户代叫下单信息</span>
            </h2>

            {/* Current City display tag */}
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <div 
                onClick={() => onShowToast(`📍 手机网络IP定位城市：${currentCity}\n🔒 派单规则：默认自动派单给【${teamName}】审批成功的同城普通司机及团队管理员`)}
                className="flex items-center gap-1 bg-[#ffdbc8]/90 hover:bg-[#ffdbc8] border border-[#dfc0af] px-2.5 py-1 rounded-full text-xs font-bold text-[#984800] shadow-xs cursor-pointer transition-all active:scale-95"
                title="点击查看城市与派单规则"
              >
                <MapPin className="w-3.5 h-3.5 text-[#ff7d00] shrink-0" />
                <span>当前城市：{currentCity}</span>
              </div>
            </div>
          </div>

          <div className="bg-white/95 border border-[#e0e0e0] rounded-2xl p-4 space-y-3.5 shadow-sm backdrop-blur-md">
            
            {/* Field 1: Pickup Point */}
            <div className="space-y-1 relative">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#584235] block">代驾商家起点</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFetchGPSLocation(false);
                  }}
                  disabled={isLocatingGPS}
                  className="text-[11px] font-bold text-[#ff7d00] flex items-center gap-1 hover:underline active:scale-95 transition-all cursor-pointer"
                >
                  <Navigation className={`w-3 h-3 ${isLocatingGPS ? 'animate-spin' : ''}`} />
                  <span>{isLocatingGPS ? 'GPS定位中...' : 'GPS重新定位'}</span>
                </button>
              </div>
              <div 
                onClick={() => {
                  setOriginSearchText(passengerAddress);
                  setShowStartLocationSearch(true);
                }}
                className="relative flex items-center bg-[#f3f3f3] border border-[#dfc0af] hover:border-[#ff7d00] rounded-xl h-11 px-3 cursor-pointer transition-all group select-none"
              >
                <MapPin className="w-4 h-4 text-[#ff7d00] shrink-0 mr-2" />
                <span className={`text-xs font-medium flex-1 truncate ${passengerAddress ? 'text-[#1a1c1c] font-bold' : 'text-[#8b7263]'}`}>
                  {passengerAddress || "点击搜索输入代驾商家起点..."}
                </span>

                {passengerAddress ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPassengerAddress('');
                      setSuggestions([]);
                    }}
                    className="px-2.5 py-1 text-xs font-bold text-[#8b7263] hover:text-[#984800] bg-white hover:bg-white/90 rounded-lg border border-[#dfc0af] shadow-xs transition-colors ml-2 shrink-0"
                  >
                    清空
                  </button>
                ) : (
                  <Search className="w-4 h-4 text-[#8b7263] shrink-0 ml-2 group-hover:text-[#ff7d00] transition-colors" />
                )}
              </div>

              {/* Headless Background 高德地图 (AMap) Instance */}
              <div className="hidden" aria-hidden="true">
                <div ref={amapContainerRef} style={{ width: '100px', height: '100px' }} />
              </div>
            </div>

            {/* Field 2: Passenger Phone */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-[#584235] block">乘客手机号码</label>
              <div className="relative flex items-center">
                <Phone className="w-4 h-4 absolute left-3 text-[#584235] shrink-0" />
                <input
                  type="tel"
                  maxLength={11}
                  value={passengerPhone}
                  onChange={(e) => setPassengerPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="请输入乘客手机号"
                  className="w-full h-11 pl-9 pr-4 bg-[#f3f3f3] border border-[#dfc0af] rounded-xl focus:ring-2 focus:ring-[#ff7d00]/30 focus:border-[#ff7d00] outline-none transition-all text-xs font-mono text-[#1a1c1c]"
                />
              </div>
            </div>

          </div>
        </section>

        {/* Section 3: Quick Options (预约时间 & 是否需要代步车) */}
        <section className="grid grid-cols-2 gap-3">
          
          {/* Card 1: 预约时间 */}
          <div 
            onClick={() => setShowTimePickerModal(true)}
            className="bg-white/95 border border-[#e0e0e0] rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer active:bg-[#f3f3f3] transition-colors shadow-sm"
          >
            <div className="w-10 h-10 rounded-full bg-[#cce5ff] flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-[#004b72]" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#1a1c1c]">预约时间</div>
              <div className="text-[11px] text-[#584235] truncate mt-0.5">{scheduledTime}</div>
            </div>
          </div>

          {/* Card 2: 是否需要代步车 */}
          <div className="bg-white/95 border border-[#e0e0e0] rounded-2xl p-3.5 flex items-center gap-2.5 shadow-sm">
            <div className="w-10 h-10 rounded-full bg-[#e2dfde] flex items-center justify-center shrink-0">
              <Bike className="w-5 h-5 text-[#474746]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[#1a1c1c] truncate">是否需要代步车</div>
              <div className="flex gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => setNeedScooter(true)}
                  className={`text-[10px] px-2 py-0.5 rounded font-bold transition-all ${
                    needScooter 
                      ? 'bg-[#ffdbc8] text-[#311300]' 
                      : 'bg-[#eeeeee] text-[#584235]'
                  }`}
                >
                  需要
                </button>
                <button
                  type="button"
                  onClick={() => setNeedScooter(false)}
                  className={`text-[10px] px-2 py-0.5 rounded font-bold transition-all ${
                    !needScooter 
                      ? 'bg-[#ffdbc8] text-[#311300]' 
                      : 'bg-[#eeeeee] text-[#584235]'
                  }`}
                >
                  不需要
                </button>
              </div>
            </div>
          </div>

        </section>

        {/* Section 4: Payment QR Code (代叫费收款二维码) */}
        <section className="space-y-3">
          <h2 className="font-bold text-base text-[#1a1c1c] flex items-center gap-1.5">
            <QrCode className="w-5 h-5 text-[#984800]" />
            <span>代叫费收款二维码</span>
          </h2>

          <div className="bg-white border border-[#dfc0af]/60 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col items-center">
            {/* WeChat Payment Badge Header */}
            <div className="flex items-center gap-2 bg-[#f3f3f3] px-4 py-1.5 rounded-full border border-gray-200">
              <svg fill="none" height="18" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.477 2 2 6.015 2 10.97c0 2.81 1.442 5.315 3.69 6.963l-.46 1.72a.5.5 0 0 0 .668.59l2.12-.96c1.233.454 2.585.717 3.982.717 5.523 0 10-4.015 10-10.97C22 6.015 17.523 2 12 2z" fill="#07C160"/>
                <path d="M7.5 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" fill="white"/>
              </svg>
              <span className="text-xs font-bold text-gray-800">微信代叫费收款码</span>
            </div>

            {/* QR Code Container styled identically to payment confirmation page */}
            <div className="relative w-60 h-60 p-3 bg-white rounded-2xl border border-gray-200 shadow-inner flex items-center justify-center overflow-hidden">
              {wechatQrUrl ? (
                <img 
                  src={wechatQrUrl} 
                  alt="微信代叫费收款码" 
                  className="w-full h-full object-contain rounded-xl"
                />
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="relative z-10 w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-[#dfc0af] rounded-xl bg-gray-50/80 p-4 cursor-pointer hover:border-[#ff7d00] transition-colors"
                >
                  <QrCode className="w-12 h-12 text-[#ff7d00]/40 mb-2" />
                  <div className="bg-[#ff7d00] p-2 rounded-xl shadow-xs">
                    <Car className="w-5 h-5 text-white" />
                  </div>
                  <p className="mt-2 text-xs text-gray-700 font-bold text-center">
                    请上传您的微信收款码
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-400 font-normal text-center">
                    作为代叫费用收款渠道
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#f3f3f3] rounded-full">
              <ShieldCheck className="w-3.5 h-3.5 text-gray-600 shrink-0" />
              <span className="text-[11px] text-gray-600 font-semibold">实名收款 · 派单人员代叫费专属</span>
            </div>

            {wechatQrUrl && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-bold text-[#ff7d00] bg-[#ff7d00]/10 hover:bg-[#ff7d00]/20 px-4 py-1.5 rounded-full transition-all cursor-pointer"
              >
                更换微信代叫费收款码
              </button>
            )}

          </div>
        </section>

      </main>

      {/* Bottom Action Bar */}
      <footer className="sticky bottom-0 left-0 right-0 z-40 bg-white border-t border-[#e2e2e2] px-5 pt-3 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),28px))] shadow-lg shrink-0 mt-auto android-nav-safe-pb">
        <div className="max-w-xl mx-auto space-y-2">
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-xs text-[#584235]">预估金额</span>
              <span className="text-base font-extrabold text-[#ff7d00]">自行协商价格</span>
            </div>
            <button 
              type="button"
              onClick={() => setShowBillingDetailModal(true)}
              className="text-xs font-bold text-[#584235] flex items-center gap-1 hover:text-[#ff7d00] transition-colors"
            >
              <span>计费详情</span>
              <Info className="w-4 h-4" />
            </button>
          </div>

          {/* 免责声明 Checkbox & Modal Trigger Group */}
          <div className="flex items-center justify-between text-xs py-1 px-1 bg-[#f9f9f9] rounded-lg border border-gray-200/60">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={isDisclaimerAgreed} 
                onChange={(e) => setIsDisclaimerAgreed(e.target.checked)} 
                className="w-4 h-4 text-[#ff7d00] focus:ring-[#ff7d00] rounded border-gray-300 accent-[#ff7d00] cursor-pointer"
              />
              <span className="text-[#584235] font-medium text-[11px]">我已阅读并同意</span>
            </label>
            <button 
              type="button"
              onClick={() => setShowDisclaimerModal(true)}
              className="text-[11px] font-bold text-[#ff7d00] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#ff7d00] shrink-0" />
              <span>《代叫代驾服务特别免责条款》</span>
            </button>
          </div>

          {(() => {
            const isFormValid = passengerAddress.trim().length > 0 && passengerPhone.trim().length > 0 && isDisclaimerAgreed;
            return (
              <button
                type="button"
                onClick={handleOneKeyDispatch}
                disabled={!isFormValid || isDispatching}
                className={`w-full h-13 font-bold text-base rounded-xl shadow-md transition-all flex items-center justify-center gap-2 ${
                  isFormValid && !isDispatching
                    ? 'bg-[#ff7d00] active:bg-[#e06d00] text-white cursor-pointer active:scale-[0.98]'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed opacity-80'
                }`}
              >
                {buttonState === 'processing' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>正在处理中...</span>
                  </>
                ) : buttonState === 'success' ? (
                  <>
                    <Check className="w-5 h-5" />
                    <span>订单发起成功</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 fill-current" />
                    <span>
                      {!passengerAddress.trim() && !passengerPhone.trim()
                        ? '一键发起代叫下单 (请输入起点及手机号)'
                        : !passengerAddress.trim()
                        ? '一键发起代叫下单 (请输入代驾起点)'
                        : !passengerPhone.trim()
                        ? '一键发起代叫下单 (请输入乘客手机号)'
                        : !isDisclaimerAgreed
                        ? '一键发起代叫下单 (请勾选免责声明)'
                        : '一键发起代叫下单'}
                    </span>
                  </>
                )}
              </button>
            );
          })()}

        </div>
      </footer>

      {/* Time Picker Modal */}
      {showTimePickerModal && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-3">
              <h3 className="font-bold text-base text-[#1a1c1c]">选择预约发车时间</h3>
              <button 
                type="button" 
                onClick={() => setShowTimePickerModal(false)}
                className="p-1 rounded-full text-[#584235] hover:bg-[#f3f3f3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 py-1">
              {['现在（立即出发）', '10分钟后', '15分钟后', '20分钟后', '30分钟后', '45分钟后', '1小时后', '2小时后'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setScheduledTime(t);
                    setShowTimePickerModal(false);
                    onShowToast(`已设置预约时间为：${t}`);
                  }}
                  className={`py-2.5 px-3 text-xs font-bold rounded-xl border transition-all ${
                    scheduledTime === t
                      ? 'bg-[#ffdbc8] border-[#ff7d00] text-[#311300]'
                      : 'bg-[#f3f3f3] border-[#e0e0e0] text-[#1a1c1c] hover:border-[#ff7d00]/50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Billing Detail Modal */}
      {showBillingDetailModal && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2.5">
              <h3 className="font-bold text-base text-[#1a1c1c] flex items-center gap-1.5">
                <Info className="w-5 h-5 text-[#ff7d00]" />
                <span>代叫服务计费说明</span>
              </h3>
              <button 
                type="button" 
                onClick={() => setShowBillingDetailModal(false)}
                className="p-1 rounded-full text-[#584235] hover:bg-[#f3f3f3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs text-[#584235] leading-relaxed">
              <div className="bg-[#f3f3f3] p-2.5 rounded-xl border border-[#e0e0e0] space-y-1">
                <p className="font-bold text-[#1a1c1c]">💰 预估金额说明</p>
                <p>商户代叫模式属于线下面对面上门服务，服务起步价及里程计费规则可由商户/商家现场与乘客直接协商确定。</p>
              </div>
              <div className="bg-[#f3f3f3] p-2.5 rounded-xl border border-[#e0e0e0] space-y-1">
                <p className="font-bold text-[#1a1c1c]">🛵 折叠代步车说明</p>
                <p>若勾选“需要代步车”，系统将优先匹配配备便携电动折叠代步车的代驾司机，确保快捷返程。</p>
              </div>
              <div className="bg-[#f3f3f3] p-2.5 rounded-xl border border-[#e0e0e0] space-y-1">
                <p className="font-bold text-[#1a1c1c]">📱 收款码绑定</p>
                <p>商家上传微信/支付宝收款码后，乘客可直接扫码支付，方便高效结算。</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowBillingDetailModal(false)}
              className="w-full py-2.5 bg-[#ff7d00] text-white font-bold text-xs rounded-xl shadow-md active:scale-[0.98] transition-transform mt-1"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* Disclaimer Modal (代叫代驾服务特别免责条款) */}
      {showDisclaimerModal && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 max-h-[85vh] flex flex-col shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2.5 shrink-0">
              <h3 className="font-bold text-base text-[#1a1c1c] flex items-center gap-1.5">
                <ShieldCheck className="w-5 h-5 text-[#ff7d00]" />
                <span>代叫代驾服务特别免责条款</span>
              </h3>
              <button 
                type="button" 
                onClick={() => setShowDisclaimerModal(false)}
                className="p-1 rounded-full text-[#584235] hover:bg-[#f3f3f3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 text-xs text-[#333] space-y-3 leading-relaxed">
              <div className="bg-amber-50 border border-amber-200/80 p-2.5 rounded-xl font-semibold text-[#8a5300]">
                使用本系统 “商户代叫代驾” 功能，您确认已充分知悉并同意如下约定：
              </div>

              <div className="space-y-1">
                <p className="font-bold text-[#1a1c1c] text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full inline-block"></span>
                  服务性质说明
                </p>
                <p className="text-gray-600 pl-2.5">
                  商户代叫代驾，是合作商户自愿协助客户发布代驾需求，本系统仅提供信息展示、需求撮合的居间信息服务，本系统不直接提供代驾驾驶服务，不参与实际代驾服务履行。代驾服务的交易价格、结算方式，全部由客户与接单代驾司机自行沟通、自行协商确认；本系统所属主体、法人不参与定价，不对代驾服务的价格合理性承担任何责任。
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-[#1a1c1c] text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full inline-block"></span>
                  主体关系界定
                </p>
                <p className="text-gray-600 pl-2.5">
                  本系统运营主体与平台接单代驾司机之间不存在劳动关系、劳务关系，双方仅属于商业合作关系。代驾服务的服务合同关系，直接成立于客户与代驾司机之间。代驾司机不属于本系统员工，不受本系统劳动管理约束。
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-[#1a1c1c] text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full inline-block"></span>
                  风险与责任划分
                </p>
                <p className="text-gray-600 pl-2.5">
                  代驾服务过程中，因客户、代驾司机一方或双方行为引发的全部纠纷，包括但不限于言语冲突、打架斗殴、人身伤害、死亡、车辆损毁、交通事故、第三方财产损失等，由相关责任方依照法律规定承担相应法律责任。
                </p>
                <p className="text-gray-600 pl-2.5">
                  除因本系统运营主体自身存在故意、重大过失导致损害发生的情形外，本系统所属经营主体、法定代表人不对客户、代驾司机及第三方遭受的人身、财产损失承担赔偿、连带法律责任。
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-[#1a1c1c] text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full inline-block"></span>
                  用户义务
                </p>
                <p className="text-gray-600 pl-2.5">
                  客户应当核验代驾司机驾驶证、从业资质；知悉代驾服务风险，谨慎选择司机；发生事故、纠纷应当优先向直接侵权人追责。本系统仅可提供纠纷调解协助，不承担赔付义务。
                </p>
              </div>

              <div className="space-y-1 border-t border-gray-100 pt-2">
                <p className="font-bold text-[#1a1c1c] text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full inline-block"></span>
                  效力确认
                </p>
                <p className="text-gray-600 pl-2.5 font-medium">
                  您点击确认、使用代叫代驾下单功能，视为您已阅读、完全理解并自愿接受本全部免责条款。
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-[#e0e0e0] shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsDisclaimerAgreed(true);
                  setShowDisclaimerModal(false);
                }}
                className="w-full py-2.5 bg-[#ff7d00] active:bg-[#e06d00] text-white font-bold text-xs rounded-xl shadow-md active:scale-[0.98] transition-all cursor-pointer"
              >
                我已完整阅读并同意免责条款
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatched Order Center Modal (商户代叫订单中心) */}
      {showOrderCenterModal && (() => {
        const displayOrders = allDispatchedOrders;
        const filteredOrders = displayOrders.filter((ord: any) => {
          if (orderCenterTab === '全部') return true;
          return ord.statusCategory === orderCenterTab;
        });

        return (
          <div className="absolute inset-0 z-50 bg-[#f9f9f9] text-[#1a1c1c] flex flex-col overflow-hidden animate-in fade-in duration-200">
            {/* TopAppBar Header */}
            <header className="w-full sticky top-0 z-50 flex items-center justify-between px-4 h-14 bg-[#f9f9f9] border-b border-[#dfc0af] shrink-0 relative">
              <div className="flex items-center gap-2">
                <button 
                  type="button"
                  onClick={() => setShowOrderCenterModal(false)}
                  className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-[#f3f3f3] active:opacity-80 transition-all text-[#984800]"
                  title="返回"
                >
                  <ArrowLeft className="w-5 h-5 text-[#984800]" />
                </button>
                <h1 className="text-base font-bold text-[#984800] shrink-0">商户代叫订单中心</h1>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold px-2.5 py-1 bg-[#ffdbc8] text-[#311300] rounded-full">
                  共 {filteredOrders.length} 单
                </span>
                <button
                  type="button"
                  title="点击一键清空列表所有订单"
                  aria-label="点击一键清空列表所有订单"
                  onClick={() => {
                    if (allDispatchedOrders.length === 0) {
                      onShowToast('当前代叫订单中心列表已经是空的');
                      return;
                    }
                    setShowConfirmClearOrdersModal(true);
                  }}
                  className="text-[11px] font-bold px-2.5 py-1 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  清空列表
                </button>
              </div>
            </header>

            <main className="flex-1 px-4 py-3 overflow-y-auto space-y-3 pb-28">
              {/* Filter Tabs */}
              <div className="flex bg-white p-1 rounded-xl border border-[#dfc0af] shadow-xs">
                {(['全部', '呼叫中', '服务中', '已完成', '已取消'] as const).map((tab) => {
                  const isActive = orderCenterTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setOrderCenterTab(tab)}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                        isActive
                          ? 'bg-[#ff7d00] text-white shadow-xs'
                          : 'text-[#584235] hover:bg-[#f3f3f3]'
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>

              {/* Orders List */}
              {filteredOrders.length === 0 ? (
                <div className="py-16 text-center text-[#584235] space-y-2 bg-white rounded-2xl border border-[#dfc0af] shadow-xs">
                  <FileText className="w-10 h-10 mx-auto text-[#dfc0af]" />
                  <p className="text-sm font-bold">暂无【{orderCenterTab}】状态的代叫订单</p>
                  <p className="text-xs text-[#584235]/70">商户下单后会自动同步显示在这里</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredOrders.map((order: any, idx: number) => {
                    const statusBg = order.statusCategory === '服务中' ? 'bg-[#00aafc]/10 text-[#006496] border-[#00aafc]/20' :
                                     order.statusCategory === '已完成' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                     order.statusCategory === '已取消' ? 'bg-gray-100 text-gray-600 border-gray-200' :
                                     'bg-[#ff7d00]/10 text-[#ff7d00] border-[#ff7d00]/20';

                    const phone = order.dispatchedByPhone || order.adminPhone || activePhone || userPhone || '';
                    const phoneLast4 = phone && phone.length >= 4 ? phone.slice(-4) : '5552';
                    const rawName = order.adminName || order.dispatchedByName;
                    const isReal = rawName && rawName !== '吴彦祖' && rawName !== '代驾司机' && rawName !== '在线代驾司机' && !rawName.startsWith('网页商户商家');
                    const dispatcherName = isReal ? rawName : `商户商家${phoneLast4}`;

                    return (
                      <div 
                        key={`m-ord-${order.id || order.orderNo || ''}-${idx}`}
                        onClick={() => setSelectedOrderDetail(order)}
                        className="bg-white p-4 rounded-2xl border border-[#dfc0af] shadow-2xs hover:border-[#ff7d00] transition-all cursor-pointer space-y-3 active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-[#1a1c1c] font-mono">
                              {order.orderNo || formatMerchantOrderNo(order, idx, filteredOrders.length)}
                            </span>
                            <span className="text-[10px] text-[#584235] bg-[#f3f3f3] px-2 py-0.5 rounded">
                              {order.city || userTeamCity || '银川市'}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 font-bold text-[10px] rounded border ${statusBg}`}>
                            {order.statusCategory || '呼叫中'}
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-2 text-[#1a1c1c]">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span className="font-bold truncate">{order.originName || order.startLocation || '顾客设定起点'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[#1a1c1c]">
                            <span className="w-2 h-2 rounded-full bg-[#ff7d00] shrink-0" />
                            <span className="font-bold truncate">{order.destName || order.destination || order.endLocation || '顾客指定目的地'}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-[#f0f0f0] text-xs text-[#584235]">
                          <div className="flex items-center gap-3">
                            <span>乘客: <strong className="text-[#1a1c1c]">{order.passengerPhone || '真实乘客'}</strong></span>
                            <span>派单人: <strong className="text-[#1a1c1c]">{dispatcherName}</strong></span>
                          </div>
                          <span className="font-bold text-sm text-[#ff7d00]">
                            {getOrderSyncPrice(order)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        );
      })()}

      {/* Management Team Modal (管理团队) */}
      {showTeamManagementModal && (() => {
        const activePhone = userPhone || '15509601222';
        const currentAdminRole = userRole || '开发者司机';
        const currentAdminName = (adminProfile.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机') ? adminProfile.name : '吴彦祖';

        const adminMember = {
          id: activePhone,
          name: currentAdminName,
          role: currentAdminRole,
          phone: activePhone,
          status: '已通过',
          approvedBy: '系统分配',
          approvedRole: '超级管理员',
          avatarBg: 'bg-[#ffdbc8] text-[#311300]',
        };

        const defaultMembers = [
          adminMember
        ];

        const isMockDriver = (item: any) => {
          if (!item) return false;
          const mockPhones = ['13912345678', '15509601223', '15555556666', 'm-1', 'm-2', 'm-3'];
          const mockNames = ['王心凌', '张一山', '李小龙'];
          return Boolean(
            (item.phone && mockPhones.includes(item.phone)) ||
            (item.id && mockPhones.includes(item.id)) ||
            (item.name && mockNames.some(mn => item.name.includes(mn)))
          );
        };

        const isRemovedItem = (item: any) => {
          if (!item) return true;
          if (isMockDriver(item)) return true;
          return Boolean(
            (item.phone && removedMemberPhones.includes(item.phone)) ||
            (item.id && removedMemberPhones.includes(item.id)) ||
            (item.name && removedMemberPhones.includes(item.name))
          );
        };

        const membersMap = new Map<string, any>();

        // 1. Fill default members (skip if removed)
        defaultMembers.forEach(m => {
          if (!isRemovedItem(m)) {
            membersMap.set(m.phone, m);
          }
        });

        // 2. Fill/Override with real Firestore squad members
        squadMembers.forEach((m, idx) => {
          if (!isRemovedItem(m)) {
            const isMe = m.phone === activePhone;
            const isMerchant = m.role?.includes('商户') || m.role?.includes('商家') || m.userRole?.includes('商户') || m.userRole?.includes('商家') || m.phone === '15121904440';
            const memberName = isMerchant ? '商户、商家' : (isMe ? currentAdminName : (m.name || `司机${m.phone.slice(-4)}`));
            const memberRole = isMerchant ? '商户、商家' : (isMe ? currentAdminRole : (m.role || '普通司机'));
            const status = m.status || '已通过';

            membersMap.set(m.phone, {
              id: m.id || m.phone || `real-${idx}`,
              name: memberName,
              role: memberRole,
              phone: m.phone,
              status,
              approvedBy: m.approvedBy || currentAdminName,
              approvedRole: m.approvedRole || currentAdminRole,
              avatarBg: isMe ? 'bg-[#ffdbc8] text-[#311300]' : 'bg-[#e2e2e2] text-[#584235]',
            });
          }
        });

        // 3. Fill/Override with applicants (sync '已通过', '待审核', '已拒绝')
        applicants.forEach(app => {
          if (!isRemovedItem(app)) {
            const existing = membersMap.get(app.phone);
            const isMerchant = app.role?.includes('商户') || app.role?.includes('商家') || app.userRole?.includes('商户') || app.userRole?.includes('商家') || existing?.role?.includes('商户') || existing?.role?.includes('商家') || app.phone === '15121904440';
            const memberName = isMerchant ? '商户、商家' : (app.name || existing?.name || `司机${app.phone.slice(-4)}`);
            const memberRole = isMerchant ? '商户、商家' : (app.role || existing?.role || '普通司机');
            const status = app.status || '待审核';
            const approvedBy = app.approvedBy || (app.status !== '待审核' ? (existing?.approvedBy || currentAdminName) : (existing?.approvedRole || ''));
            const approvedRole = app.approvedRole || (app.status !== '待审核' ? (existing?.approvedRole || currentAdminRole) : (existing?.approvedRole || ''));

            membersMap.set(app.phone, {
              id: app.id || app.phone,
              name: memberName,
              role: memberRole,
              phone: app.phone,
              status,
              approvedBy,
              approvedRole,
              avatarBg: status === '已通过' 
                ? 'bg-[#e2e2e2] text-[#584235]' 
                : status === '已拒绝' 
                ? 'bg-rose-100 text-rose-800' 
                : 'bg-amber-100 text-amber-800',
            });
          }
        });

        // 4. Fill/Override with merchant users registered via 商户代叫（手机网页版）
        merchantUsers.forEach((mu, idx) => {
          if (mu?.phone && !isRemovedItem(mu)) {
            membersMap.set(mu.phone, {
              id: mu.id || mu.phone || `merchant-${idx}`,
              name: '商户、商家',
              role: '商户、商家',
              phone: mu.phone,
              status: '已通过',
              approvedBy: '系统自动审批',
              approvedRole: '系统自动',
              avatarBg: 'bg-[#e0e0e0] text-[#333]',
            });
          }
        });

        // Always ensure current admin is set
        membersMap.set(activePhone, adminMember);

        const allMembersList = Array.from(membersMap.values())
          .filter(m => !isRemovedItem(m) || m.phone === activePhone)
          .map(m => {
            const isMe = m.phone === activePhone;
            const roleTagClass = m.role.includes('开发者') ? 'bg-indigo-100 text-indigo-700 border-indigo-200' :
                                  m.role.includes('老板') ? 'bg-[#ff7d00]/10 text-[#ff7d00] border-[#ff7d00]/20' :
                                  m.role.includes('管理') ? 'bg-[#00aafc]/10 text-[#006496] border-[#00aafc]/20' :
                                  'bg-[#e2e2e2] text-[#584235] border-[#dfc0af]';

            const statusTagClass = m.status === '已通过' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                   m.status === '已拒绝' ? 'bg-rose-100 text-rose-800 border-rose-200' :
                                   'bg-amber-100 text-amber-800 border-amber-200';

            const footprint = isMe
              ? '超级管理员（实时同步派单与调度日志）'
              : m.status === '已通过'
              ? '由系统自动审批通过'
              : m.status === '已拒绝'
              ? `由${m.approvedBy || currentAdminName} (${m.approvedRole || currentAdminRole}) 审批拒绝`
              : `待${currentAdminName} (${currentAdminRole}) 审核批复中`;

            return {
              ...m,
              roleTagClass,
              statusTagClass,
              footprint
            };
          });

        const driverMembersList = allMembersList.filter(item => !(item.role?.includes('商户') || item.role?.includes('商家')));
        const merchantMembersList = allMembersList.filter(item => item.role?.includes('商户') || item.role?.includes('商家'));

        const driverCount = driverMembersList.length;
        const merchantCount = merchantMembersList.length;

        return (
        <div className="absolute inset-0 z-50 bg-[#f9f9f9] text-[#1a1c1c] flex flex-col overflow-hidden animate-in fade-in duration-200">
          
          {/* TopAppBar Header */}
          <header className="w-full sticky top-0 z-50 flex items-center justify-between px-5 h-16 bg-[#f9f9f9] border-b border-[#dfc0af] shrink-0 relative">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-[#984800] shrink-0">管理团队</h1>
            </div>

            {/* Centered Member Application & Merchant Management Buttons */}
            <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
              {canReviewApplicants && (
                <button 
                  type="button"
                  onClick={() => setShowApplicantApprovalModal(true)}
                  className="relative flex items-center gap-1 px-2.5 py-1 bg-[#ffdbc8] text-[#311300] hover:bg-[#ffbfa3] rounded-full text-xs font-bold shadow-xs active:scale-95 transition-all border border-[#ff7d00]/20 whitespace-nowrap shrink-0 cursor-pointer"
                  title="成员申请"
                >
                  <UserPlus className="w-3.5 h-3.5 text-[#984800] shrink-0" />
                  <span className="whitespace-nowrap">成员申请</span>
                  {pendingApplicantCount > 0 && (
                    <span className="flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-[#ba1a1a] text-[10px] font-bold text-white leading-none shrink-0">
                      {pendingApplicantCount}
                    </span>
                  )}
                </button>
              )}

              <button 
                type="button"
                onClick={() => {
                  setMemberCategoryTab('商户、商家');
                  onShowToast('🏢 已为您切换至【商户管理】页面');
                }}
                className={`relative flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shadow-xs active:scale-95 transition-all border whitespace-nowrap shrink-0 ${
                  memberCategoryTab === '商户、商家'
                    ? 'bg-[#ff7d00] text-white border-[#ff7d00]'
                    : 'bg-[#ffdbc8] text-[#311300] hover:bg-[#ffbfa3] border-[#ff7d00]/20'
                }`}
                title="商户管理"
              >
                <Store className="w-3.5 h-3.5 text-[#984800] shrink-0" />
                <span className="whitespace-nowrap">商户管理</span>
                {merchantCount > 0 && (
                  <span className="flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-[#027a48] text-[10px] font-bold text-white leading-none shrink-0">
                    {merchantCount}
                  </span>
                )}
              </button>
            </div>

            <div className="w-2"></div>
          </header>

          <main className="flex-1 px-5 py-4 overflow-y-auto space-y-4 pb-28">
            {/* Current Identity Card */}
            <section>
              <div className="bg-white border border-[#dfc0af] rounded-2xl p-4 shadow-xs relative overflow-hidden">
                {/* Decorative element */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#ff7d00]/10 rounded-bl-[100px] -mr-4 -mt-4 pointer-events-none" />
                
                <div className="flex justify-between items-start mb-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-[#584235]">我的身份（管理员级别）</span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-[#ff7d00] text-white text-xs font-bold rounded-md">
                        {userRole || '开发者司机'}
                      </span>
                      {isEditingAdminName ? (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            maxLength={8}
                            value={tempAdminName}
                            onChange={(e) => setTempAdminName(e.target.value)}
                            className="text-xs font-bold px-2 py-0.5 border border-[#ff7d00] rounded bg-white outline-none w-28 text-[#1a1c1c]"
                            placeholder="最多8字"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handleSaveAdminName}
                            className="text-xs bg-[#ff7d00] text-white px-2 py-0.5 rounded font-bold shrink-0 shadow-xs active:scale-95 transition-transform"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsEditingAdminName(false)}
                            className="text-xs bg-[#e0e0e0] text-[#584235] px-1.5 py-0.5 rounded font-bold shrink-0"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-lg font-bold text-[#1a1c1c]">
                            {(() => {
                              const isMgmt = isManagementRole || activePhone === '15509601222' || ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'].includes(userRole);
                              if (isMgmt) {
                                return (adminProfile.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机') ? adminProfile.name : '吴彦祖';
                              }
                              if (adminProfile.name && adminProfile.name !== '代驾司机' && adminProfile.name !== '在线代驾司机' && !adminProfile.name.startsWith('网页商户商家代叫')) {
                                return adminProfile.name;
                              }
                              return `网页商户商家代叫${activePhone ? activePhone.slice(-4) : '5554'}`;
                            })()}
                          </span>
                          {isManagementRole && (
                            <button
                              type="button"
                              onClick={() => {
                                setTempAdminName(adminProfile.name);
                                setIsEditingAdminName(true);
                              }}
                              className="flex items-center gap-0.5 text-[#ff7d00] hover:text-[#984800] text-xs font-bold transition-colors"
                              title="修改名字"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>修改名字</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <span className="text-xs font-bold text-[#584235] block whitespace-nowrap">小队人数</span>
                      <span className="text-xl sm:text-2xl font-bold text-[#ff7d00] whitespace-nowrap">
                        {driverCount}
                        <span className="text-xs sm:text-sm font-normal text-[#584235] ml-0.5">人</span>
                      </span>
                    </div>
                    <div className="w-[1px] h-8 bg-[#dfc0af]/40" />
                    <div className="text-right">
                      <span className="text-xs font-bold text-[#584235] block whitespace-nowrap">商户</span>
                      <span className="text-xl sm:text-2xl font-bold text-[#027a48] whitespace-nowrap">
                        {merchantCount}
                        <span className="text-xs sm:text-sm font-normal text-[#584235] ml-0.5">家</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-[#dfc0af]/30">
                  <span className="text-sm text-[#584235] italic">团队规模持续增长中...</span>
                </div>
              </div>
            </section>

            {/* Search Bar */}
            <section>
              <div className="relative flex items-center">
                <Search className="w-5 h-5 absolute left-3.5 text-[#584235]/70 pointer-events-none" />
                <input 
                  type="tel"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="输入手机号码查找小队成员"
                  className="w-full h-12 pl-11 pr-4 bg-white border border-[#dfc0af] rounded-2xl focus:ring-2 focus:ring-[#ff7d00] focus:border-[#ff7d00] transition-all text-sm placeholder:text-[#584235]/50 outline-none"
                />
                {memberSearchQuery && (
                  <button 
                    type="button"
                    onClick={() => setMemberSearchQuery('')}
                    className="absolute right-3.5 text-[#8b7263] hover:text-[#1a1c1c]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </section>

            {/* Member List */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-bold text-[#584235]">成员列表</h2>
                <div className="flex gap-4 text-xs font-bold">
                  {(['全部', '管理层', '司机', '商户、商家'] as const).map((tab) => {
                    const isActive = memberCategoryTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setMemberCategoryTab(tab)}
                        className={`relative transition-colors ${
                          isActive ? 'text-[#984800]' : 'text-[#584235]'
                        }`}
                      >
                        {tab}
                        {isActive && (
                          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#984800]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Members Data List */}
              {(() => {
                // Filter by search query & category tab
                const filteredMembers = allMembersList.filter(item => {
                  if (memberSearchQuery.trim()) {
                    const q = memberSearchQuery.trim().toLowerCase();
                    const matchPhone = item.phone?.toLowerCase().includes(q);
                    const matchName = item.name?.toLowerCase().includes(q);
                    if (!matchPhone && !matchName) return false;
                  }

                  if (memberCategoryTab === '全部') {
                    // Exclude merchants from "全部" tab list
                    return !(item.role?.includes('商户') || item.role?.includes('商家'));
                  }
                  if (memberCategoryTab === '管理层') {
                    return (item.role?.includes('管理') || item.role?.includes('老板') || item.role?.includes('开发者')) && !(item.role?.includes('商户') || item.role?.includes('商家'));
                  }
                  if (memberCategoryTab === '司机') {
                    return (item.role?.includes('司机') || item.role === '普通司机') && !(item.role?.includes('商户') || item.role?.includes('商家'));
                  }
                  if (memberCategoryTab === '商户、商家') {
                    return item.role?.includes('商户') || item.role?.includes('商家');
                  }
                  return true;
                });

                if (filteredMembers.length === 0) {
                  return (
                    <div className="py-12 text-center text-[#584235] space-y-2 bg-white rounded-2xl border border-[#dfc0af]">
                      <Users className="w-8 h-8 text-[#8b7263] mx-auto" />
                      <p className="text-sm font-bold">未找到匹配的小队成员</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    {filteredMembers.map((member) => {
                      const isMerchantMember = member.role === '商户、商家' || member.role?.includes('商户') || member.role?.includes('商家') || member.phone === '15121904440';
                      const assignableRoles = getAllowedAssignRoles(member);
                      const canChangeRole = !isMerchantMember && assignableRoles.length > 0;
                      const memberDisplayName = isMerchantMember ? '商户、商家' : member.name;

                      if (isMerchantMember) {
                        return (
                          <div 
                            key={member.id}
                            className="flex items-center justify-between bg-white p-4 rounded-2xl border border-[#dfc0af] shadow-2xs hover:border-[#ff7d00]/40 transition-all"
                          >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              {/* Gray circle avatar with '商' */}
                              <div className="w-12 h-12 rounded-full bg-[#e0e0e0] text-[#333] flex items-center justify-center font-bold text-lg shrink-0">
                                商
                              </div>
                              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-base text-[#1a1c1c]">商户、商家</span>
                                  <span className="px-2 py-0.5 text-xs text-[#555] bg-[#e8e8e8] border border-[#d0d0d0] rounded-md font-normal">
                                    商户、商家
                                  </span>
                                </div>
                                <div className="mt-0.5">
                                  <span className="px-2 py-0.5 text-xs font-bold text-[#027a48] bg-[#d1fadf] border border-[#a6f4c5] rounded-md inline-block">
                                    已通过
                                  </span>
                                </div>
                                <span className="text-sm text-[#1a1c1c] font-mono font-medium mt-0.5">{member.phone}</span>
                                <span className="text-xs text-[#888] block">由系统自动审批通过</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <a 
                                href={`tel:${member.phone}`}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-[#ffeedd] text-[#ff7d00] hover:bg-[#ff7d00] hover:text-white transition-all active:scale-95"
                                title="拨打电话"
                              >
                                <Phone className="w-4 h-4 fill-current" />
                              </a>
                              <button 
                                type="button"
                                onClick={async () => {
                                  const targetPhone = member.phone;
                                  setRemovedMemberPhones(prev => {
                                    const updated = Array.from(new Set([...prev, targetPhone].filter(Boolean)));
                                    try {
                                      localStorage.setItem('dd_removed_squad_phones_v2', JSON.stringify(updated));
                                    } catch (_) {}
                                    return updated;
                                  });
                                  if (db && targetPhone) {
                                    try {
                                      await deleteDoc(doc(db, 'merchant_users', targetPhone));
                                    } catch (_) {}
                                  }
                                  setMerchantUsers(prev => prev.filter(m => m.phone !== targetPhone));
                                  onShowToast(`🗑️ 已解绑并移除商户/商家 (${targetPhone})`);
                                }}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-[#ffebee] text-[#d32f2f] hover:bg-[#d32f2f] hover:text-white transition-all active:scale-95"
                                title="删除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div 
                          key={member.id}
                          className="flex items-center justify-between bg-white p-4 rounded-2xl border border-[#dfc0af] shadow-2xs hover:border-[#ff7d00]/40 transition-all"
                        >
                          <div className="flex items-center gap-3.5 min-w-0 flex-1">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0 ${member.avatarBg}`}>
                              {member.name ? member.name.charAt(0) : '司'}
                            </div>
                            <div className="flex flex-col gap-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                {/* Name rendering and inline edit (max 8 chars) */}
                                {editingMemberPhone === member.phone ? (
                                  <div className="inline-flex items-center gap-1 my-0.5">
                                    <input
                                      type="text"
                                      maxLength={8}
                                      value={editingMemberNameTemp}
                                      onChange={(e) => setEditingMemberNameTemp(e.target.value)}
                                      className="text-xs font-bold px-2 py-1 border border-[#ff7d00] rounded-lg bg-white outline-none w-28 text-[#1a1c1c]"
                                      placeholder="最多8字"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSaveMemberName(member.phone, editingMemberNameTemp)}
                                      className="text-xs bg-[#ff7d00] text-white px-2 py-1 rounded-lg font-bold shrink-0 shadow-xs active:scale-95 transition-transform"
                                    >
                                      保存
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingMemberPhone(null)}
                                      className="text-xs bg-[#e0e0e0] text-[#584235] px-1.5 py-1 rounded-lg font-bold shrink-0"
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-bold text-base text-[#1a1c1c] truncate max-w-[120px]" title={memberDisplayName}>
                                      {memberDisplayName}
                                    </span>
                                    {isManagementRole && !isMerchantMember && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingMemberPhone(member.phone);
                                          setEditingMemberNameTemp(member.name || '');
                                        }}
                                        className="flex items-center gap-0.5 text-[#ff7d00] hover:text-[#984800] text-xs font-bold transition-colors shrink-0"
                                        title="修改成员名字（最多8字）"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                        <span className="text-[10px]">改名</span>
                                      </button>
                                    )}
                                  </div>
                                )}

                                {/* Role tag with dropdown selector if user has role assignment permission */}
                                {canChangeRole ? (
                                  <div className="relative inline-block shrink-0">
                                    <select
                                      value={member.role}
                                      onChange={(e) => handleUpdateMemberRole(member, e.target.value)}
                                      className={`px-2 py-0.5 font-bold text-[10px] rounded border appearance-none pr-5 cursor-pointer outline-none ${member.roleTagClass}`}
                                      title="点击更改角色"
                                    >
                                      {!assignableRoles.includes(member.role) && (
                                        <option value={member.role}>{member.role}</option>
                                      )}
                                      {assignableRoles.map((r) => (
                                        <option key={r} value={r} className="text-xs text-[#1a1c1c] bg-white">
                                          {r}
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown className="w-2.5 h-2.5 absolute right-1 top-1.5 pointer-events-none opacity-70" />
                                  </div>
                                ) : (
                                  <span className={`px-2 py-0.5 font-bold text-[10px] rounded border shrink-0 ${member.roleTagClass}`}>
                                    {member.role}
                                  </span>
                                )}

                                {/* Status Tag (已通过 / 待审核 / 已拒绝) */}
                                {member.status && (
                                  <span className={`px-2 py-0.5 font-bold text-[10px] rounded border shrink-0 ${member.statusTagClass}`}>
                                    {member.status}
                                  </span>
                                )}
                              </div>

                              <span className="text-sm text-[#584235] font-mono">{member.phone}</span>
                              <span className="text-[10px] text-[#584235]/70 block truncate">
                                {member.footprint}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-2 shrink-0 ml-2">
                            <a 
                              href={`tel:${member.phone}`}
                              className="w-10 h-10 flex items-center justify-center rounded-full bg-[#ff7d00]/10 text-[#ff7d00] hover:bg-[#ff7d00] hover:text-white transition-all active:scale-95"
                              title="拨打电话"
                            >
                              <Phone className="w-4 h-4 fill-current" />
                            </a>
                            {isManagementRole && (
                              <button 
                                type="button"
                                onClick={async () => {
                                  const targetPhone = member.phone;
                                  const targetId = member.id;
                                  const targetName = member.name;

                                  // 1. Mark as removed locally in state & localStorage
                                  setRemovedMemberPhones(prev => {
                                    const updated = Array.from(new Set([...prev, targetPhone, targetId, targetName].filter(Boolean)));
                                    try {
                                      localStorage.setItem('dd_removed_squad_phones_v2', JSON.stringify(updated));
                                    } catch (_) {}
                                    return updated;
                                  });

                                  // 2. Directly update React states so UI removes member instantly
                                  setSquadMembers(prev => {
                                    const updated = prev.filter((m: any) => 
                                      m.phone !== targetPhone && m.id !== targetId && m.name !== targetName && m.phone !== targetId
                                    );
                                    try {
                                      localStorage.setItem('dd_squad_members_v2', JSON.stringify(updated));
                                    } catch (_) {}
                                    return updated;
                                  });

                                  setApplicants(prev => {
                                    const updated = prev.filter((a: any) => 
                                      a.phone !== targetPhone && a.id !== targetId && a.name !== targetName && a.phone !== targetId
                                    );
                                    try {
                                      localStorage.setItem('dd_applicants_v2', JSON.stringify(updated));
                                    } catch (_) {}
                                    return updated;
                                  });

                                  // 3. Delete from Firestore database
                                  if (targetPhone) {
                                    try {
                                      await deleteDoc(doc(db, 'squad_members', targetPhone));
                                    } catch (e) {
                                      console.error(e);
                                    }
                                  }
                                  if (targetId && targetId !== targetPhone) {
                                    try {
                                      await deleteDoc(doc(db, 'squad_members', targetId));
                                    } catch (e) {
                                      console.error(e);
                                    }
                                  }

                                  onShowToast(`已成功彻底删除成员: ${targetName || '司机'}`);
                                }}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-[#ffdad6] text-[#ba1a1a] hover:bg-[#ba1a1a] hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
                                title="移除成员"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>
          </main>
        </div>
      );
    })()}

      {/* Order Detail View Modal */}
      {selectedOrderDetail && (
        <div className="absolute inset-0 z-50 bg-[#f9f9f9] text-[#1a1c1c] flex flex-col overflow-hidden animate-in fade-in duration-200">
          {/* TopAppBar */}
          <header className="bg-[#f9f9f9] sticky top-0 z-50 border-b border-[#e2e2e2] flex items-center justify-between px-5 h-14 shrink-0">
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={() => setSelectedOrderDetail(null)}
                className="p-1.5 rounded-full hover:bg-black/5 transition-colors flex items-center justify-center"
              >
                <ArrowLeft className="w-5 h-5 text-[#984800]" />
              </button>
              <h1 className="text-lg font-bold text-[#984800]">订单详情</h1>
            </div>
            <button 
              type="button" 
              onClick={() => setShowCancelDispatchModal(true)}
              className="px-2.5 py-1 text-xs sm:text-sm font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 active:scale-95 transition-all cursor-pointer"
            >
              取消派单
            </button>
          </header>

          {/* 取消派单确认弹窗 */}
          {showCancelDispatchModal && (
            <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl max-w-xs sm:max-w-sm w-full p-6 shadow-2xl flex flex-col items-center text-center space-y-4 relative z-[10000]">
                <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mb-1">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                  </svg>
                </div>
                <h3 className="text-base font-extrabold text-gray-900 leading-snug">
                  是否确认取消此订单的派单？
                </h3>
                <div className="flex items-center gap-3 w-full pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCancelDispatchModal(false)}
                    className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm rounded-xl transition-all active:scale-95 cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCancelDispatch}
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-rose-600/30 active:scale-95 cursor-pointer"
                  >
                    确认
                  </button>
                </div>
              </div>
            </div>
          )}

          <main className="flex-1 p-5 overflow-y-auto space-y-4 pb-28">
            {/* Order Status Header Card */}
            {(() => {
              const sc = selectedOrderDetail?.statusCategory || '';
              const st = selectedOrderDetail?.status || '';
              const isCancelled = sc === '已取消' || sc === '订单已取消' || st === 'cancelled';

              const getStepIndex = (ord: any) => {
                if (!ord) return 1;
                const c = ord.statusCategory || '';
                const s = ord.status || '';

                if (c === '已完成' || s === 'completed' || s === 'finished') return 5;
                if (c === '服务中' || c === '计费中' || c === '进行中' || s === 'serving' || s === 'started' || s === 'in_service') return 4;
                if (c === '司机到达' || c === '已到达' || s === 'arrived') return 3;
                if (c === '司机接单' || c === '已接单' || c === '已指派' || c === '已抢单' || s === 'claimed' || s === 'accepted' || s === 'taken' || s === 'dispatched') return 2;
                return 1;
              };

              const activeIndex = getStepIndex(selectedOrderDetail);

              let displayStatusText = '呼叫中';
              if (isCancelled) {
                displayStatusText = '该订单已取消';
              } else if (activeIndex === 5) {
                displayStatusText = '已完成';
              } else if (activeIndex === 4) {
                displayStatusText = '服务中';
              } else if (activeIndex === 3) {
                displayStatusText = '司机到达';
              } else if (activeIndex === 2) {
                displayStatusText = '司机接单';
              } else {
                displayStatusText = '呼叫中';
              }

              const progressPercent = activeIndex === 5 ? '100%' :
                                      activeIndex === 4 ? '75%' :
                                      activeIndex === 3 ? '50%' :
                                      activeIndex === 2 ? '25%' : '0%';

              const stepsList = [
                { step: '呼叫中', index: 1 },
                { step: '司机接单', index: 2 },
                { step: '司机到达', index: 3 },
                { step: '服务中', index: 4 },
                { step: '已完成', index: 5 },
              ];

              return (
                <div className="bg-white border border-[#e2e2e2] rounded-xl p-4 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className={`text-lg font-black ${isCancelled ? 'text-rose-600' : 'text-[#ff7d00]'}`}>
                      {displayStatusText}
                    </span>
                    <span className="text-xs text-[#584235] font-semibold">
                      订单编号: {selectedOrderDetail.orderNo || formatMerchantOrderNo(selectedOrderDetail)}
                    </span>
                  </div>

                  {isCancelled ? (
                    /* Hides 5-step tracker when cancelled, directly displays '该订单已取消' banner */
                    <div className="bg-rose-50 border border-rose-200/80 rounded-xl p-3.5 flex items-center justify-center gap-2">
                      <span className="text-sm font-extrabold text-rose-600">该订单已取消</span>
                    </div>
                  ) : (
                    /* Step Tracker */
                    <div className="relative flex justify-between items-start pt-1">
                      {/* Tracker Line Background */}
                      <div className="absolute top-3 left-0 w-full h-[2px] bg-[#e2e2e2]" />
                      {/* Tracker Line Progress */}
                      <div 
                        className="absolute top-3 left-0 h-[2px] bg-[#ff7d00] transition-all duration-300" 
                        style={{ width: progressPercent }}
                      />

                      {stepsList.map((s) => {
                        const isPassedOrCurrent = s.index <= activeIndex;
                        const isCurrent = s.index === activeIndex;

                        return (
                          <div key={s.step} className="relative z-10 flex flex-col items-center gap-1.5">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                              isCurrent 
                                ? 'bg-[#ff7d00] text-white shadow-[0_0_0_4px_rgba(255,125,0,0.25)] font-bold text-xs' 
                                : isPassedOrCurrent 
                                ? 'bg-[#ff7d00] text-white font-bold text-xs' 
                                : 'bg-[#e2e2e2] text-[#888888] font-bold text-xs'
                            }`}>
                              {isPassedOrCurrent ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : s.index}
                            </div>
                            <span className={`text-[10px] font-bold ${
                              isCurrent ? 'text-[#ff7d00] font-black' : isPassedOrCurrent ? 'text-[#984800]' : 'text-[#888888]'
                            }`}>
                              {s.step}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Admin/Dispatcher Card */}
            {(() => {
              const rawName = selectedOrderDetail.adminName || selectedOrderDetail.dispatchedByName;
              const isReal = rawName && rawName !== '吴彦祖' && rawName !== '代驾司机' && rawName !== '在线代驾司机' && !rawName.startsWith('网页商户商家');
              const fullPhone = selectedOrderDetail.dispatchedByPhone || selectedOrderDetail.adminPhone || '18795165552';
              const phoneLast4 = fullPhone && fullPhone.length >= 4 ? fullPhone.slice(-4) : '5552';
              const displayName = isReal ? rawName : `商户商家${phoneLast4}`;

              const mgmtRoles = ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'];
              const orderAdminRole = selectedOrderDetail.adminRole || selectedOrderDetail.dispatcherRole;

              let displayRole = '商户、商家';
              if (fullPhone !== '15121904440' && orderAdminRole && mgmtRoles.includes(orderAdminRole)) {
                displayRole = orderAdminRole;
              } else if (fullPhone !== '15121904440') {
                const sm = squadMembers.find((m: any) => m.phone === fullPhone);
                if (sm && sm.role && mgmtRoles.includes(sm.role)) {
                  displayRole = sm.role;
                }
              }

              if (!mgmtRoles.includes(displayRole)) {
                displayRole = '商户、商家';
              }

              return (
                <div className="bg-white border border-[#e2e2e2] rounded-xl p-4 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-[#cce5ff] flex items-center justify-center text-[#006496]">
                      <Headphones className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-base text-[#1a1c1c]">{displayName}</p>
                        <span className="px-2 py-0.5 bg-[#00aafc] text-white rounded text-[10px] font-bold">
                          {displayRole}
                        </span>
                      </div>
                      <p className="text-xs font-mono font-bold text-[#ff7d00] mt-0.5">
                        派单手机: {fullPhone}
                      </p>
                      <p className="text-[10px] text-[#584235]">派单管理员信息</p>
                    </div>
                  </div>
                  <a 
                    href={`tel:${fullPhone}`}
                    className="w-9 h-9 rounded-full bg-[#ff7d00] flex items-center justify-center text-white shadow-sm active:scale-95 transition-transform"
                    title={`拨打派单员手机: ${fullPhone}`}
                  >
                    <Phone className="w-4 h-4 fill-current" />
                  </a>
                </div>
              );
            })()}

            {/* Order Core Info Card */}
            <div className="bg-white border border-[#e2e2e2] rounded-xl p-4 space-y-3.5 shadow-sm">
              <div className="flex justify-between items-center pb-2 border-b border-[#eeeeee]">
                <p className="text-xs text-[#584235] font-semibold">订单详情</p>
                <div className="flex items-center gap-1 text-[#ff7d00] font-bold text-sm">
                  <span>订单金额:</span>
                  <span className="text-base font-bold">{getOrderSyncPrice(selectedOrderDetail)}</span>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-[#984800] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-[#584235] font-semibold">订单起点</p>
                    <p className="font-bold text-sm text-[#1a1c1c]">{selectedOrderDetail.startLocation || selectedOrderDetail.originName || '未填写起点'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Clock className="w-4 h-4 text-[#584235] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-[#584235] font-semibold">预约出发时间</p>
                    <p className="font-bold text-sm text-[#1a1c1c]">{selectedOrderDetail.scheduledTime || '立即出发'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-[#584235] mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] text-[#584235] font-semibold">备注</p>
                    <p className="text-xs text-[#1a1c1c] bg-[#f3f3f3] p-2 rounded-lg mt-0.5">
                      {selectedOrderDetail.orderRemark || selectedOrderDetail.rawOrder?.orderRemark || '商户代叫'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-[#f3f3f3] rounded-lg">
                  <span className="text-xs text-[#584235]">需要折叠代步车</span>
                  <span className="px-2.5 py-0.5 bg-[#ff7d00] text-white rounded-full text-[10px] font-bold">
                    {selectedOrderDetail.needScooter !== false && selectedOrderDetail.rawOrder?.needScooter !== false ? '需要' : '不需要'}
                  </span>
                </div>
              </div>
            </div>

            {/* Passenger & Driver Info Card */}
            {(() => {
              const rawDriverPhone = (
                selectedOrderDetail.dispatchedDriverPhone ||
                selectedOrderDetail.rawOrder?.driverPhone || 
                selectedOrderDetail.driverPhone || 
                ''
              ).toString().replace(/[-\s]/g, '');

              let resolvedDriverName = '';

              // 1. Look up in active squadMembers state
              const matchedMember = squadMembers.find(
                (m: any) => (m.phone && m.phone.replace(/[-\s]/g, '') === rawDriverPhone) || m.id === rawDriverPhone
              );
              if (matchedMember && matchedMember.name) {
                resolvedDriverName = matchedMember.name;
              }

              // 2. Look up in localStorage dd_squad_members_v2 or dd_applicants_v2
              if (!resolvedDriverName) {
                try {
                  const savedM = JSON.parse(localStorage.getItem('dd_squad_members_v2') || '[]');
                  const m = savedM.find((item: any) => (item.phone && item.phone.replace(/[-\s]/g, '') === rawDriverPhone) || item.id === rawDriverPhone);
                  if (m && m.name) resolvedDriverName = m.name;
                } catch (_) {}
              }

              if (!resolvedDriverName) {
                try {
                  const savedA = JSON.parse(localStorage.getItem('dd_applicants_v2') || '[]');
                  const a = savedA.find((item: any) => (item.phone && item.phone.replace(/[-\s]/g, '') === rawDriverPhone) || item.id === rawDriverPhone);
                  if (a && a.name) resolvedDriverName = a.name;
                } catch (_) {}
              }

              // 3. Look up in order properties if not placeholder
              if (!resolvedDriverName) {
                const candidate = selectedOrderDetail.driverDisplayName || selectedOrderDetail.driverName || selectedOrderDetail.rawOrder?.driverName || selectedOrderDetail.rawOrder?.driverDisplayName;
                if (candidate) {
                  resolvedDriverName = candidate;
                }
              }

              // 4. Fallback
              if (!resolvedDriverName) {
                resolvedDriverName = rawDriverPhone ? '在线接单司机' : '等待接单中';
              }

              const cleanDriverPhone = rawDriverPhone || '暂无';

              return (
                <div className="bg-white border border-[#e2e2e2] rounded-xl shadow-sm overflow-hidden text-xs">
                  <div className="p-3.5 border-b border-[#eeeeee]">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 text-[#584235]">
                        <User className="w-4 h-4 text-[#584235]" />
                        <span className="font-bold text-sm text-[#1a1c1c]">乘客电话</span>
                      </div>
                      <span className="font-bold text-sm tracking-wider text-[#1a1c1c]">
                        {selectedOrderDetail.passengerPhone || selectedOrderDetail.rawOrder?.passengerPhone || '真实乘客电话'}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 flex items-center justify-between gap-2 max-w-full overflow-hidden">
                    <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                      <div className="w-10 h-10 rounded-full bg-[#ff7d00]/10 border border-[#ff7d00]/30 flex items-center justify-center text-[#ff7d00] font-bold text-sm shrink-0">
                        {resolvedDriverName?.[0] || '司'}
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="font-bold text-sm text-[#1a1c1c] truncate">
                          接单司机：{resolvedDriverName}
                        </p>
                        <p className="text-xs text-[#584235] font-mono truncate">
                          {cleanDriverPhone}
                        </p>
                      </div>
                    </div>

                    {rawDriverPhone && (
                      <a 
                        href={`tel:${cleanDriverPhone}`}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#e8e8e8] rounded-full hover:bg-[#e2e2e2] transition-colors text-[#984800] font-bold text-xs shrink-0 whitespace-nowrap"
                      >
                        <Phone className="w-3.5 h-3.5 fill-current shrink-0" />
                        <span>一键拨打</span>
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}
          </main>
        </div>
      )}

      {/* Full-Screen Start Location Search Page Modal */}
      {showStartLocationSearch && (
        <div className="absolute inset-0 z-50 bg-[#f9f9f9] text-[#1a1c1c] flex flex-col overflow-hidden animate-in fade-in duration-200">
          {/* TopAppBar Header */}
          <header className="bg-[#f9f9f9] sticky top-0 z-50 border-b border-[#e2e2e2] flex items-center justify-between px-4 h-14 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowStartLocationSearch(false)}
                className="p-1.5 rounded-lg hover:bg-black/5 transition-colors flex items-center gap-1 text-[#584235]"
              >
                <ArrowLeft className="w-5 h-5 text-[#984800]" />
                <span className="text-xs font-bold text-[#984800]">返回</span>
              </button>
              <h1 className="text-base font-bold text-[#1a1c1c] ml-1">搜索输入起点</h1>
            </div>

            <button
              type="button"
              onClick={() => {
                if (originSearchText.trim()) {
                  setPassengerAddress(originSearchText.trim());
                }
                setShowStartLocationSearch(false);
              }}
              className="bg-[#984800] text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs hover:opacity-90 active:scale-95 transition-all"
            >
              确定起点
            </button>
          </header>

          {/* Search Bar */}
          <div className="p-4 bg-white border-b border-[#e2e2e2] shrink-0">
            <div className="relative flex items-center bg-[#f3f3f3] border border-[#dfc0af] focus-within:border-[#ff7d00] focus-within:ring-2 focus-within:ring-[#ff7d00]/20 rounded-xl px-3 py-2.5 transition-all">
              <MapPin className="w-4 h-4 text-[#ff7d00] shrink-0 mr-2.5" />
              <input
                type="text"
                value={originSearchText}
                onChange={(e) => setOriginSearchText(e.target.value)}
                placeholder="搜索商家名称 / 酒楼 / KTV / 详细起点地址"
                className="w-full bg-transparent border-none outline-none text-xs font-bold text-[#1a1c1c] placeholder:text-[#8b7263] placeholder:font-normal p-0"
                autoFocus
              />
              {originSearchText && (
                <button
                  type="button"
                  onClick={() => setOriginSearchText('')}
                  className="p-1 rounded-full hover:bg-black/10 text-[#8b7263] hover:text-[#1a1c1c] transition-colors ml-1 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Search Content / Suggestions / Popular Merchants */}
          <main className="flex-1 overflow-y-auto p-4 space-y-4">
            {originSuggestions.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-[#8b7263] px-1 uppercase tracking-wider">
                  匹配起点搜索建议
                </p>
                <div className="bg-white border border-[#e2e2e2] rounded-xl overflow-hidden shadow-xs divide-y divide-[#f0f0f0]">
                  {originSuggestions.map((tip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setPassengerAddress(tip.name);
                        if (tip.location) {
                          setPassengerCoords({
                            lat: tip.location.lat,
                            lng: tip.location.lng
                          });
                        }
                        setShowStartLocationSearch(false);
                      }}
                      className="w-full text-left p-3.5 hover:bg-[#f3f3f3] flex items-center gap-3 transition-colors cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-full bg-[#ff7d00]/10 flex items-center justify-center text-[#ff7d00] shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-[#1a1c1c] truncate">{tip.name}</h4>
                        <p className="text-[10px] text-[#8b7263] truncate mt-0.5">{tip.address || tip.district || '详细地址'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {originSearchText.trim() ? (
                  <div className="p-3.5 bg-[#ffdbc8]/50 border border-[#dfc0af] rounded-xl space-y-2">
                    <p className="text-xs text-[#311300] font-bold">
                      当前输入的起点：<span className="text-[#984800]">{originSearchText}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setPassengerAddress(originSearchText.trim());
                        setShowStartLocationSearch(false);
                      }}
                      className="w-full py-2 bg-[#984800] text-white text-xs font-bold rounded-lg hover:opacity-90 active:scale-95 transition-all shadow-sm"
                    >
                      使用当前输入的文本作为代驾起点
                    </button>
                  </div>
                ) : (
                  <div className="py-12 text-center text-[#8b7263] text-xs">
                    请输入关键词搜索起点地址
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {/* Applicant Approval Modal (团队审核 - 申请审批) */}
      {showApplicantApprovalModal && (
        <div className="absolute inset-0 z-50 bg-[#f9f9f9] text-[#1a1c1c] flex flex-col overflow-hidden animate-in fade-in duration-200">
          {/* TopAppBar */}
          <header className="bg-[#f9f9f9] w-full sticky top-0 z-50 border-b border-[#e2e2e2] flex justify-between items-center px-4 sm:px-5 h-14 shrink-0">
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={() => setShowApplicantApprovalModal(false)}
                className="active:scale-95 transition-transform hover:bg-[#f3f3f3] p-2 rounded-full flex items-center justify-center text-[#984800]"
                title="返回"
              >
                <ArrowLeft className="w-5 h-5 text-[#984800]" />
              </button>
              <h1 className="text-base sm:text-lg font-bold text-[#1a1c1c]">申请审批</h1>
            </div>
            <button 
              type="button"
              onClick={() => onShowToast('🔍 已自动筛选显示待处理成员申请')}
              className="active:scale-95 transition-transform hover:bg-[#f3f3f3] p-2 rounded-full flex items-center justify-center text-[#584235]"
              title="筛选"
            >
              <SlidersHorizontal className="w-5 h-5 text-[#584235]" />
            </button>
          </header>

          {/* Main Content Canvas */}
          <main className="flex-1 px-4 sm:px-5 py-4 space-y-4 overflow-y-auto pb-24">
            {/* Permission Banner */}
            <div className="bg-[#fff2e6] border border-[#ff7d00]/30 rounded-xl p-3 flex items-start gap-2.5 shadow-xs">
              <ShieldCheck className="w-5 h-5 text-[#ff7d00] shrink-0 mt-0.5" />
              <div className="text-xs text-[#584235] space-y-0.5">
                <p className="font-bold text-[#311300]">审核审批权限说明：</p>
                <p>【开发者司机】、【城市老板司机】、【城市管理司机】、【城市派单员司机】均拥有全权对申请人进行<strong>审批通过</strong>或<strong>审批不通过</strong>的判定。</p>
              </div>
            </div>

            {applicants.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#e2e2e2] p-8 text-center text-[#8b7263]">
                <UserPlus className="w-10 h-10 mx-auto mb-2 text-[#dfc0af]" />
                <p className="font-bold text-sm text-[#584235]">暂无待处理的小队申请记录</p>
                <p className="text-xs text-[#8b7263] mt-1">当有司机提交入队申请后，此处将自动显示并可审核审批</p>
              </div>
            ) : (
              applicants.map((applicant) => (
              <div 
                key={applicant.id}
                className="bg-white rounded-xl border border-[#e2e2e2] p-4 flex flex-col gap-3 shadow-xs"
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="font-bold text-base text-[#1a1c1c]">{applicant.name}</span>
                    <span className="text-sm text-[#584235] font-mono">{applicant.phone}</span>
                  </div>
                  <div className={`px-2.5 py-1 rounded text-xs font-bold ${
                    applicant.status === '已通过' 
                      ? 'bg-emerald-100 text-emerald-800' 
                      : applicant.status === '已拒绝'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-[#eeeeee] text-[#584235]'
                  }`}>
                    {applicant.status}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-[#584235] uppercase tracking-wider">
                    申请备注
                  </label>
                  <div className={`bg-white border border-[#e2e2e2] rounded-lg p-3 text-sm text-[#1a1c1c] ${!applicant.note ? 'italic opacity-60' : ''}`}>
                    {applicant.note || '该申请人未填写具体备注。'}
                  </div>
                  <p className="text-[#584235]/70 text-[11px] px-1 flex items-center gap-1 mt-0.5">
                    <Info className="w-3.5 h-3.5 shrink-0 text-[#584235]" />
                    <span>备注越详细越能增加审核通过的概率</span>
                  </p>
                </div>

                {applicant.status !== '待审核' && applicant.approvedBy && (
                  <div className="bg-[#f9f9f9] border border-[#e2e2e2] rounded-lg p-2.5 text-xs text-[#584235] flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 font-bold text-[#1a1c1c]">
                      <span>审批记录：</span>
                      <span className="text-[#ff7d00]">{applicant.approvedBy}</span>
                      <span className="text-[10px] bg-[#ff7d00]/10 text-[#ff7d00] px-1.5 py-0.2 rounded border border-[#ff7d00]/20">{applicant.approvedRole}</span>
                    </div>
                    {applicant.approvalTime && (
                      <span className="text-[11px] text-[#584235]/70">处理时间: {applicant.approvalTime}</span>
                    )}
                    {applicant.status === '已拒绝' && applicant.selectedReasons && applicant.selectedReasons.length > 0 && (
                      <span className="text-rose-700 font-medium mt-0.5">不通过原因: {applicant.selectedReasons.join('，')}</span>
                    )}
                  </div>
                )}

                {applicant.status === '待审核' && (
                  <div className="flex flex-col gap-2 pt-2">
                    <button 
                      type="button"
                      onClick={() => handleApproveApplicant(applicant.id, applicant.name)}
                      className="w-full bg-[#ff7d00] hover:bg-[#984800] text-white font-bold text-sm py-3 rounded-lg active:scale-95 transition-transform shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span>审批通过</span>
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        if (!canReviewApplicants) {
                          onShowToast('⚠️ 您暂无审批权限，仅【开发者司机、城市老板司机、城市管理司机、城市派单员司机】可以审核');
                          return;
                        }
                        setApplicants(prev => prev.map(a => a.id === applicant.id ? { ...a, showReasons: !a.showReasons } : a));
                      }}
                      className="w-full bg-white border border-[#ff7d00] text-[#ff7d00] font-bold text-sm py-3 rounded-lg active:scale-95 transition-transform cursor-pointer"
                    >
                      审批不通过
                    </button>
                  </div>
                )}

                {/* Rejection Reasons Panel */}
                {applicant.status === '待审核' && applicant.showReasons && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-[#e2e2e2] mt-1 animate-in fade-in duration-200">
                    <p className="text-xs font-bold text-[#584235]">选择不通过原因：</p>
                    <div className="flex flex-wrap gap-2">
                      {['备注填写不详细', '无法核实您的身份准确性'].map((reason) => {
                        const isSelected = applicant.selectedReasons.includes(reason);
                        return (
                          <div 
                            key={reason}
                            onClick={() => {
                              setApplicants(prev => prev.map(a => {
                                if (a.id !== applicant.id) return a;
                                const reasons = isSelected 
                                  ? a.selectedReasons.filter(r => r !== reason)
                                  : [...a.selectedReasons, reason];
                                return { ...a, selectedReasons: reasons };
                              }));
                            }}
                            className={`cursor-pointer px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                              isSelected 
                                ? 'border-[#ff7d00] bg-[#fff2e6] text-[#ff7d00] font-bold'
                                : 'border-[#e2e2e2] bg-[#f3f3f3] text-[#584235] hover:border-[#ff7d00]'
                            }`}
                          >
                            {reason}
                          </div>
                        );
                      })}
                    </div>
                    <button 
                      type="button"
                      onClick={() => handleRejectApplicant(applicant.id, applicant.name)}
                      className="mt-2 bg-[#ba1a1a] hover:bg-[#93000a] text-white font-bold text-sm py-2.5 rounded-lg active:opacity-80 transition-all shadow-xs cursor-pointer"
                    >
                      确认拒绝
                    </button>
                  </div>
                )}
              </div>
            )))}
          </main>
        </div>
      )}

      {/* Custom Confirmation Modal for Clearing Orders - Removed as requested */}
      {false && showConfirmClearOrdersModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-rose-100 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#1a1c1c]">彻底清空订单列表</h3>
                <p className="text-xs text-[#584235] mt-0.5">此操作不可撤销</p>
              </div>
            </div>

            <p className="text-xs text-[#584235] bg-rose-50/80 p-3 rounded-xl border border-rose-100 leading-relaxed">
              确定要一键彻底清空【商户代叫订单中心】里的全部 <span className="font-bold text-rose-600">{allDispatchedOrders.length}</span> 笔订单（包含真实与虚拟订单）吗？
            </p>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmClearOrdersModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-[#f3f3f3] text-[#584235] hover:bg-[#e8e8e8] active:scale-95 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExecuteClearAllOrders}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 active:scale-95 transition-all shadow-md cursor-pointer"
              >
                确认彻底清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Cancel Order Dialog Modal */}
      {showCancelConfirmDialog && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xs rounded-2xl p-5 shadow-2xl border border-gray-100 flex flex-col items-center text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-[#ff7d00] flex items-center justify-center font-bold text-xl">
              ?
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-base text-gray-900">确认取消当前订单？</h3>
              <p className="text-xs text-gray-500">此笔订单取消后，将返回首页，且不会在选单大厅里显示。</p>
            </div>
            <div className="flex items-center gap-2 w-full pt-1">
              <button
                type="button"
                onClick={() => setShowCancelConfirmDialog(false)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs transition-all active:scale-95 cursor-pointer"
              >
                返回
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelOrder}
                className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-all active:scale-95 shadow-xs cursor-pointer"
              >
                确认取消
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
