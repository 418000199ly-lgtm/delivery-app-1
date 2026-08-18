import React, { useState, useEffect } from 'react';
import { ArrowLeft, ShieldCheck, Info, QrCode, Car } from 'lucide-react';
import { TripState, ChauffeurSettings } from '../types';
import { db, doc, onSnapshot } from '../lib/dbProxy';

interface MerchantValetPaymentViewProps {
  trip: TripState;
  settings?: ChauffeurSettings;
  wechatClean?: string;
  onNavigateBack: () => void;
  onFinishTrip: (amount: number) => void;
}

export default function MerchantValetPaymentView({
  trip,
  settings,
  wechatClean,
  onNavigateBack,
  onFinishTrip
}: MerchantValetPaymentViewProps) {
  const [dispatcherQr, setDispatcherQr] = useState<string>('');

  useEffect(() => {
    const dispatchedBy = (trip as any)?.dispatchedByPhone || (trip as any)?.dispatchedBy || (trip as any)?.dispatcherPhone;
    const initialQr = (trip as any)?.paymentQrCode || (trip as any)?.merchantPaymentQrCode || '';

    if (initialQr) {
      setDispatcherQr(initialQr);
    }

    if (dispatchedBy) {
      const savedLocal = localStorage.getItem(`dd_dispatch_wechat_qr_${dispatchedBy}`) || localStorage.getItem(`dd_dispatch_fee_qr_${dispatchedBy}`);
      if (savedLocal) {
        setDispatcherQr(savedLocal);
      }

      if (db) {
        const unsub1 = onSnapshot(doc(db, 'dispatch_qrs', dispatchedBy), (snap) => {
          if (snap.exists() && snap.data()?.qrCode) {
            setDispatcherQr(snap.data().qrCode);
          }
        });
        const unsub2 = onSnapshot(doc(db, 'dispatch_qrcodes', dispatchedBy), (snap) => {
          if (snap.exists() && snap.data()?.qrCode) {
            setDispatcherQr(snap.data().qrCode);
          }
        });
        return () => { unsub1(); unsub2(); };
      }
    } else if (!initialQr) {
      // Do not fallback to generic QR codes (dd_wechat_qr, etc.) to prevent showing incorrect QR codes
      // when the specific dispatcher hasn't uploaded one.
      setDispatcherQr('');
    }
  }, [trip]);

  const handleConfirmSent = () => {
    onFinishTrip(trip.calculatedTotalFee);
  };

  const handleReturnHome = () => {
    onFinishTrip(trip.calculatedTotalFee);
  };

  const qrImage = dispatcherQr || (trip as any)?.paymentQrCode || '';

  return (
    <div className="w-full h-full min-h-screen bg-[#f9f9f9] text-[#1a1c1c] select-none font-sans overflow-y-auto relative">
      {/* TopAppBar */}
      <header className="sticky top-0 left-0 w-full z-50 flex items-center px-4 h-16 bg-[#f9f9f9]/95 border-b border-[#dfc0af]/60 backdrop-blur-md shrink-0">
        <div className="flex items-center w-full max-w-md mx-auto">
          <button 
            type="button"
            onClick={onNavigateBack}
            className="transition-colors duration-200 active:opacity-70 p-2 -ml-2 text-[#984800] hover:bg-[#984800]/10 rounded-full cursor-pointer"
            aria-label="返回"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="flex-grow text-center font-bold text-lg text-[#984800] tracking-wide">
            商户代叫费收款
          </h1>
          <div className="w-10"></div> {/* Spacer for centering */}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="pt-4 pb-12 px-4 relative flex flex-col justify-between max-w-md mx-auto w-full min-h-[calc(100vh-64px)]">
        {/* Background Texture Overlay */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20" 
          style={{
            backgroundImage: 'linear-gradient(#e0e0e0 1px, transparent 1px), linear-gradient(90deg, #e0e0e0 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        />

        <div className="relative z-10 space-y-5">
          {/* Payment Core Card */}
          <div className="bg-white rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] border border-[#dfc0af]/60 overflow-hidden">
            {/* Payment Methods Tabs */}
            <div className="flex border-b border-[#dfc0af]/50 bg-[#f3f3f3]/50">
              <button 
                type="button"
                className="flex-1 py-3.5 text-center font-bold text-sm relative transition-colors text-[#984800]"
              >
                微信支付
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-[#ff7d00] rounded-full" />
              </button>
            </div>

            {/* QR Content */}
            <div className="p-5 flex flex-col items-center">
              <div className="mb-2 text-[#1a1c1c] font-bold text-sm text-center px-2 leading-snug">
                代叫订单：{trip.startLocation || '北京东路（铂金大厦）'} 的商户代叫费
              </div>
              
              <div className="mb-1 text-xs font-semibold text-gray-500">
                代叫订单收款金额
              </div>

              <div className="mb-4 flex items-baseline justify-center">
                <span className="text-xl font-bold text-[#1a1c1c] mr-1">¥</span>
                <span className="text-4xl font-black text-[#1a1c1c] tracking-tight font-mono">
                  10.00
                </span>
              </div>

              {/* QR Code Container */}
              <div className="relative w-64 h-64 p-3 bg-white rounded-2xl border border-gray-200 shadow-inner flex items-center justify-center">
                {qrImage && qrImage.trim() !== '' ? (
                  <img 
                    src={qrImage} 
                    alt="微信代叫费收款码" 
                    className="w-full h-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="relative z-10 w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-[#dfc0af] rounded-xl bg-gray-50/80 p-4">
                    <QrCode className="w-16 h-16 text-[#ff7d00]/40 mb-2" />
                    <div className="bg-[#ff7d00] p-2 rounded-xl shadow-xs">
                      <Car className="w-6 h-6 text-white" />
                    </div>
                    <p className="mt-3 text-[11px] text-gray-600 font-bold text-center">
                      请派单人员先在【商户代叫系统】上传微信代叫费收款码
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-1.5 px-4 py-1.5 bg-[#f3f3f3] rounded-full">
                <ShieldCheck className="w-4 h-4 text-gray-600 shrink-0" />
                <span className="text-xs text-gray-600 font-semibold">实名收款 · 支付保障</span>
              </div>
            </div>
          </div>

          {/* Hint Section */}
          <div className="space-y-2 px-1">
            <div className="flex gap-2.5">
              <Info className="w-5 h-5 text-[#984800] shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm text-gray-600 leading-relaxed">
                  请截图此页面<span className="text-[#1a1c1c] font-bold">微信识别</span>发送代叫费用。
                </p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  或用另一个手机微信<span className="text-[#1a1c1c] font-bold">扫描此页面</span>给代叫人员发送代叫费用。
                </p>
                <p className="text-xs text-gray-400 leading-relaxed mt-2">
                  温馨提示：请先在此页面将代叫费用发送成功后，在点击返回首页
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Area */}
        <div className="pt-6 space-y-3 relative z-10 pb-8">
          <button 
            type="button"
            onClick={handleConfirmSent}
            className="w-full bg-[#ff7d00] hover:bg-[#e06d00] active:scale-[0.98] text-white py-3.5 rounded-xl font-bold text-base shadow-[0_4px_12px_rgba(255,125,0,0.25)] transition-all cursor-pointer"
          >
            代叫费用确认已发送
          </button>
          <button 
            type="button"
            onClick={handleReturnHome}
            className="w-full border-2 border-[#984800] text-[#984800] hover:bg-[#984800]/5 active:scale-[0.98] py-3.5 rounded-xl font-bold text-base bg-transparent transition-all cursor-pointer"
          >
            返回首页
          </button>
        </div>
      </main>
    </div>
  );
}
