import React, { useState } from 'react';
import { ArrowLeft, MapPin, Phone, Info, CheckCircle2 } from 'lucide-react';
import { db, doc, setDoc, getDocs, collection, getBaseApiUrl } from '../lib/dbProxy';
import { geocodeAddress, calculateHaversineDistanceKm, formatDistance, DEFAULT_YINCHUAN_COORDS, isValidCoords } from '../utils/geocoding';
import { speakText } from '../utils/speech';

interface ReportTransferOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string | null;
  defaultPickup?: string;
}

export default function ReportTransferOrderModal({
  isOpen,
  onClose,
  userPhone,
  defaultPickup = '运祥小区'
}: ReportTransferOrderModalProps) {
  const currentPickup = defaultPickup || '运祥小区';
  const [passengerPhone, setPassengerPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [dispatchResultMsg, setDispatchResultMsg] = useState<{ title: string; desc: string; isHall: boolean } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPickup.trim()) {
      alert('乘客起点不能为空！');
      return;
    }
    const cleanPhone = passengerPhone.replace(/\D/g, '').trim();
    if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith('1')) {
      alert('请输入有效的中国大陆11位手机号码！');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Geocode start location
      const pickupCoords = geocodeAddress(currentPickup);
      const pLat = pickupCoords.lat;
      const pLng = pickupCoords.lng;

      // 2. Fetch candidate drivers in team/squad (小队内的司机)
      const squadPhones = new Set<string>();
      try {
        const squadSnap = await getDocs(collection(db, 'squad_members'));
        squadSnap.forEach(d => squadPhones.add(d.id));
      } catch (_) {}

      try {
        const savedSq = JSON.parse(localStorage.getItem('dd_squad_members_v2') || '[]');
        if (Array.isArray(savedSq)) {
          savedSq.forEach((m: any) => {
            const p = typeof m === 'string' ? m : (m?.phone || m?.userPhone);
            if (p) squadPhones.add(p);
          });
        }
      } catch (_) {}

      // Management roles
      const managementPhones = new Set<string>();
      try {
        const teamSnap = await getDocs(collection(db, 'team_members'));
        teamSnap.forEach(d => {
          const data = d.data();
          if (data && ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(data.role)) {
            if (data.phone) managementPhones.add(data.phone);
          }
        });
      } catch (_) {}

      // Driver users
      const driverDocs: Array<{ phone: string; data: any }> = [];
      try {
        const driverSnap = await getDocs(collection(db, 'driver_users'));
        driverSnap.forEach(d => {
          driverDocs.push({ phone: d.id, data: d.data() });
        });
      } catch (_) {}

      if (driverDocs.length === 0) {
        try {
          const baseUrl = getBaseApiUrl();
          const res = await fetch(`${baseUrl}/api/db/list?col=driver_users`);
          if (res.ok) {
            const json = await res.json();
            if (json && Array.isArray(json.data)) {
              json.data.forEach((item: any) => {
                if (item && item.id) {
                  driverDocs.push({ phone: item.id, data: item.data || item });
                }
              });
            }
          }
        } catch (_) {}
      }

      // Filter candidates
      const candidates: Array<{ phone: string; name: string; lat: number; lng: number; distKm: number }> = [];

      driverDocs.forEach(({ phone, data }) => {
        if (!data || data.isBanned) return;
        const isOnline = Boolean(data.isOnline || data.onlineOrdersEnabled);
        if (!isOnline) return;

        const isSquadMember = squadPhones.has(phone) || managementPhones.has(phone) || phone === '15509601222' || (userPhone && phone === userPhone);
        if (!isSquadMember) return;

        // Check if driver is free (not busy in serving state)
        const isBusy = Boolean(data.hasActiveOrder || data.currentStatus === 'serving');
        if (isBusy) return;

        let dLat = Number(data.lat);
        let dLng = Number(data.lng);

        if (!isValidCoords(dLat, dLng) && userPhone && phone === userPhone) {
          const sLat = localStorage.getItem('dd_bg_driver_coords_lat');
          const sLng = localStorage.getItem('dd_bg_driver_coords_lng');
          if (sLat && sLng && isValidCoords(Number(sLat), Number(sLng))) {
            dLat = Number(sLat);
            dLng = Number(sLng);
          }
        }

        if (!isValidCoords(dLat, dLng)) {
          dLat = DEFAULT_YINCHUAN_COORDS.lat;
          dLng = DEFAULT_YINCHUAN_COORDS.lng;
        }

        const distKm = calculateHaversineDistanceKm(pLat, pLng, dLat, dLng);

        // Only candidates within 3.0 km radius
        if (distKm <= 3.0) {
          candidates.push({
            phone,
            name: data.driverName || '小队司机',
            lat: dLat,
            lng: dLng,
            distKm
          });
        }
      });

      // Always include current driver if logged in, online and within 3km
      if (userPhone && !candidates.some(c => c.phone === userPhone)) {
        const isLoggedOnline = localStorage.getItem('dd_driver_is_online') !== 'false';
        if (isLoggedOnline) {
          let sLat = Number(localStorage.getItem('dd_bg_driver_coords_lat'));
          let sLng = Number(localStorage.getItem('dd_bg_driver_coords_lng'));
          if (!isValidCoords(sLat, sLng)) {
            sLat = DEFAULT_YINCHUAN_COORDS.lat;
            sLng = DEFAULT_YINCHUAN_COORDS.lng;
          }
          const distKm = calculateHaversineDistanceKm(pLat, pLng, sLat, sLng);
          if (distKm <= 3.0) {
            candidates.push({
              phone: userPhone,
              name: localStorage.getItem('dd_driver_name') || '当前小队司机',
              lat: sLat,
              lng: sLng,
              distKm
            });
          }
        }
      }

      const orderId = 'RT' + Date.now();
      const baseUrl = getBaseApiUrl();

      if (candidates.length > 0) {
        // Find closest distance
        const minDist = Math.min(...candidates.map(c => c.distKm));
        // Find all candidates with exact same minimum distance (within 1 meter threshold)
        const sameMinDistCandidates = candidates.filter(c => Math.abs(c.distKm - minDist) < 0.001);
        // If multiple drivers have same distance, randomly select one
        const selectedDriver = sameMinDistCandidates[Math.floor(Math.random() * sameMinDistCandidates.length)];

        const calculatedDistText = (userPhone && selectedDriver.phone === userPhone)
          ? '0公里'
          : (selectedDriver.distKm < 0.05 ? '0米' : formatDistance(selectedDriver.distKm));

        // Order Payload for Direct Dispatch
        const orderPayload = {
          id: orderId,
          orderId: orderId,
          passengerPhone: cleanPhone,
          startLocation: currentPickup,
          destination: '报单转单：由司机与乘客口头沟通目的地',
          status: 'submitted',
          timestamp: Date.now(),
          isValetOrder: true,
          isPlatformDispatch: true,
          orderRemark: '报单转单',
          orderType: '报单转单',
          type: '报单转单',
          passengerLat: pLat,
          passengerLng: pLng,
          approxPrice: '未知',
          scheduledTime: '现在出发',
          needScooter: false,
          dispatchedDriverPhone: selectedDriver.phone,
          dispatchedDriverName: selectedDriver.name,
          merchantPhone: userPhone || '',
          reporterPhone: userPhone || '',
          dispatchedByPhone: userPhone || '',
          dispatchedBy: userPhone || '',
          distanceText: calculatedDistText,
        };

        // 1. Dispatch directly into passenger_links of nearest driver
        await setDoc(doc(db, 'passenger_links', selectedDriver.phone), orderPayload).catch(() => {});
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'passenger_links', docId: selectedDriver.phone, data: orderPayload })
        }).catch(() => {});

        // 2. Also record in merchant_orders
        await setDoc(doc(db, 'merchant_orders', orderId), {
          ...orderPayload,
          status: 'dispatched',
          statusCategory: '派单给司机',
          createdAt: Date.now()
        }).catch(() => {});

        // 3. If selected driver is current user, trigger local popup instantly
        if (userPhone && (selectedDriver.phone === userPhone || selectedDriver.phone === '15509601222')) {
          window.dispatchEvent(new CustomEvent('trigger_incoming_order', { detail: orderPayload }));
        }

        setDispatchResultMsg({
          title: '报单转单派单成功',
          desc: `已派单给方圆3公里内最近的小队司机【${selectedDriver.name} (${selectedDriver.phone})】，直线距离 ${formatDistance(minDist)}，司机APP已实时弹出新来单界面！`,
          isHall: false
        });

      } else {
        // No driver within 3km -> Enter Order Lobby (选单大厅)
        const hallOrderPayload = {
          id: orderId,
          orderId: orderId,
          passengerPhone: cleanPhone,
          startLocation: currentPickup,
          destination: '报单转单：由司机与乘客口头沟通目的地',
          status: 'hall',
          statusCategory: '等待接单',
          in_hall: true,
          timestamp: Date.now(),
          createdAt: Date.now(),
          isValetOrder: true,
          isPlatformDispatch: true,
          orderRemark: '报单转单',
          orderType: '报单转单',
          type: '报单转单',
          passengerLat: pLat,
          passengerLng: pLng,
          approxPrice: '未知',
          scheduledTime: '现在出发',
          needScooter: false,
          merchantPhone: userPhone || '',
          reporterPhone: userPhone || '',
          dispatchedByPhone: userPhone || '',
          dispatchedBy: userPhone || '',
          merchantName: '报单转单'
        };

        await setDoc(doc(db, 'merchant_orders', orderId), hallOrderPayload).catch(() => {});
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'merchant_orders', docId: orderId, data: hallOrderPayload })
        }).catch(() => {});

        // Sync local storage and trigger event for Order Lobby
        try {
          const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
          saved.unshift(hallOrderPayload);
          localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(saved));
        } catch (_) {}

        window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
        speakText('选单大厅有新订单了');

        setDispatchResultMsg({
          title: '订单已转入选单大厅',
          desc: '方圆3公里内暂无在线空闲司机，报单转单已自动转入【选单大厅】，本小队内的司机均可进行抢单！',
          isHall: true
        });
      }

      setIsSubmitting(false);
      setShowSuccessToast(true);

      setTimeout(() => {
        setShowSuccessToast(false);
        setPassengerPhone('');
        onClose();
      }, 2500);

    } catch (err) {
      console.error("Error in ReportTransferOrder submit:", err);
      setIsSubmitting(false);
      alert('呼叫代叫司机失败，请重试！');
    }
  };

  return (
    <div className="absolute inset-0 z-[100] bg-[#f9f9f9] text-[#1a1c1c] flex flex-col font-sans select-none overflow-hidden animate-in fade-in duration-200">
      
      {/* TopAppBar - Fixed Height Header */}
      <header className="sticky top-0 z-10 bg-white flex items-center justify-between px-4 h-12 border-b border-[#e2e2e2] shrink-0 shadow-2xs">
        <button 
          type="button"
          onClick={onClose}
          className="text-[#584235] hover:bg-[#e2e2e2] p-1.5 rounded-full flex items-center justify-center transition-colors cursor-pointer"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5 text-gray-800" />
        </button>
        <h1 className="text-base font-bold text-[#984800] tracking-wide">报单转单</h1>
        <div className="w-8" /> {/* Spacer */}
      </header>

      {/* Main Content Container */}
      <main className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-8 overflow-y-auto space-y-3">
        
        {/* Top Content Group: Full Driver Illustration */}
        <div className="flex flex-col items-center text-center shrink-0">
          <div className="w-full h-[180px] sm:h-[200px] rounded-2xl overflow-hidden mb-3 flex items-center justify-center bg-gradient-to-b from-[#f3f3f3] to-[#f9f9f9] border border-[#e2e2e2] shadow-sm">
            <img 
              className="w-full h-full object-cover object-top" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBVW-SPu0Hka2ulxdNTpXegg7i0k4TtLpLI336RtyCWMHauFWLFE2Z8kUUZJ11yZTBTftYHLo2sfg1ksCdtFR0lPbBz9eOyQ375MhZRC2vTch6ve3z_eytZik2K0wm00B4kh93uyMW8sxKhSHtJgkyFgYL1sa4wlYlDLMemHcIUX15yvf3WCgeLPHYHEQQ2QgVEWDfKJeY5mP6V2WLU2f3WBZc-ktnLW6AV5jLDaS3BMxaGX6pkUVs5zQ" 
              alt="报单转单代叫司机"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>

          {/* Slogan */}
          <div className="pt-1 pb-1">
            <h2 className="text-base sm:text-lg font-extrabold text-[#1a1c1c] leading-tight">
              报单转单越多，
            </h2>
            <h2 className="text-base sm:text-lg font-extrabold text-[#ff7d00] leading-tight mt-0.5">
              赚取代叫费用越多！
            </h2>
          </div>
        </div>

        {/* Middle Group: Form Inputs & Submit Button */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 shrink-0">
          <div className="bg-white rounded-xl border border-[#e2e2e2] p-2.5 shadow-2xs flex flex-col gap-2">
            {/* Pickup Input - Readonly */}
            <div className="relative flex items-center bg-[#f4f4f4] rounded-lg border border-[#e2e2e2] px-2.5 py-0.5 select-none">
              <div className="text-[#ff7d00] shrink-0 mr-2 flex items-center">
                <MapPin className="w-4 h-4 fill-[#ff7d00]/20 text-[#ff7d00]" />
              </div>
              <input 
                type="text"
                value={currentPickup}
                readOnly
                disabled
                placeholder="乘客起点"
                className="w-full bg-transparent border-none outline-none text-xs sm:text-sm font-bold text-gray-700 py-2 cursor-default"
                style={{ outline: 'none', boxShadow: 'none' }}
              />
              <span className="text-[10px] text-gray-400 shrink-0 ml-1 bg-gray-200/80 px-1.5 py-0.5 rounded font-medium">不可更改</span>
            </div>

            {/* Phone Input */}
            <div className="relative flex items-center bg-[#f9f9f9] rounded-lg border border-[#e2e2e2] focus-within:border-[#ff7d00] focus-within:ring-1 focus-within:ring-[#ff7d00] transition-all px-2.5 py-0.5">
              <div className="text-[#ff7d00] shrink-0 mr-2 flex items-center">
                <Phone className="w-4 h-4 text-[#ff7d00]" />
              </div>
              <input 
                type="tel"
                inputMode="numeric"
                maxLength={11}
                value={passengerPhone}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 11);
                  setPassengerPhone(cleaned);
                }}
                placeholder="请输入乘客手机号码"
                className="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-xs sm:text-sm font-bold text-gray-800 placeholder:text-gray-400 py-2"
                style={{ outline: 'none', boxShadow: 'none' }}
              />
            </div>
          </div>

          {/* Action Button */}
          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#ff7d00] hover:bg-[#e06d00] active:bg-[#c96200] disabled:bg-gray-300 text-white font-bold text-sm py-3 rounded-xl shadow-md shadow-orange-500/20 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                正在智能派单中...
              </span>
            ) : (
              '立即呼叫司机'
            )}
          </button>
        </form>

        {/* Bottom Group: Warm Tips Card */}
        <section className="bg-[#eee] p-2.5 rounded-xl border border-[#e2e2e2] shrink-0 mb-4">
          <div className="flex items-start gap-1.5">
            <Info className="w-4 h-4 text-[#984800] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#5f5e5e] leading-snug font-medium">
              温馨提示：恶意报单转单，视情节严重小队管理会封禁当前账号，账号封禁期间不补会员有效期时长。
            </p>
          </div>
        </section>

      </main>

      {/* Success Toast Overlay */}
      {showSuccessToast && dispatchResultMsg && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-30 p-6 animate-in zoom-in-95 duration-150">
          <div className="bg-white rounded-2xl p-5 shadow-2xl flex flex-col items-center text-center max-w-xs border border-gray-100">
            <div className={`w-11 h-11 rounded-full ${dispatchResultMsg.isHall ? 'bg-amber-100' : 'bg-green-100'} flex items-center justify-center mb-2.5`}>
              <CheckCircle2 className={`w-7 h-7 ${dispatchResultMsg.isHall ? 'text-amber-600' : 'text-[#07c160]'}`} />
            </div>
            <h3 className="text-sm font-extrabold text-gray-900 mb-1.5">{dispatchResultMsg.title}</h3>
            <p className="text-xs text-gray-600 leading-relaxed font-medium">{dispatchResultMsg.desc}</p>
          </div>
        </div>
      )}

    </div>
  );
}
