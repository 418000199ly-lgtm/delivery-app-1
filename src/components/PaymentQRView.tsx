import React, { useState, useEffect } from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { TripState, ChauffeurSettings } from '../types';
import DriverIllustration from './DriverIllustration';
import MerchantValetPaymentView from './MerchantValetPaymentView';
import { MOCK_ALBUM_PHOTOS } from '../utils/mockImages';
import { autoUpdateOrderDestinationIfUnset, isUnsetDestination } from '../utils/locationResolver';

function cleanAndRegenerate(dataUrl: string, type: 'wechat' | 'alipay'): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        
        // Scan original QR payload using jsQR
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth'
        });
        
        if (code && code.data) {
          // Re-generate complete, clean, vector-exact high-contrast black-white QR code
          QRCode.toDataURL(code.data, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 450,
            color: {
              dark: '#000000',
              light: '#ffffff'
            }
          }).then(resolve).catch((err) => {
            console.error('QRCode generation failed in view', err);
            resolve(dataUrl);
          });
        } else {
          // Use user's uploaded image directly if jsQR can't scan payload
          resolve(dataUrl);
        }
      } catch (err) {
        console.error('Failed in cleanAndRegenerate processing', err);
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
  });
}

interface PaymentQRViewProps {
  trip: TripState;
  settings?: ChauffeurSettings;
  onNavigateBack: () => void;
  onFinishTrip: (amount: number) => void;
  onUpdateTrip?: (updated: TripState) => void;
}

export default function PaymentQRView({
  trip,
  settings,
  onNavigateBack,
  onFinishTrip,
  onUpdateTrip
}: PaymentQRViewProps) {
  const [isWechat, setIsWechat] = useState(true);
  const [wechatClean, setWechatClean] = useState<string>('');
  const [alipayClean, setAlipayClean] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(true);
  const [showValetFeePayment, setShowValetFeePayment] = useState<boolean>(false);
  const [currentTripState, setCurrentTripState] = useState<TripState>(trip);

  useEffect(() => {
    setCurrentTripState(trip);
  }, [trip]);

  // Auto-resolve destination if unset upon reaching payment confirmation screen (w3)
  useEffect(() => {
    const activeDest = currentTripState.endLocation || (currentTripState as any).destination || (currentTripState as any).dropoffName;
    if (isUnsetDestination(activeDest)) {
      autoUpdateOrderDestinationIfUnset(currentTripState, settings?.phoneNumber, (updated) => {
        setCurrentTripState(updated);
        if (onUpdateTrip) {
          onUpdateTrip(updated);
        }
      });
    }
  }, [currentTripState.id]);

  const isMerchantValetOrder = Boolean(
    (trip as any)?.isValetOrder ||
    (trip as any)?.isPlatformDispatch ||
    trip?.orderType === '后台指派订单' ||
    (trip as any)?.orderRemark === '商户代叫' ||
    (trip as any)?.isMerchantValet
  );

  useEffect(() => {
    const processQrs = async () => {
      setIsProcessing(true);
      
      // 1. WeChat
      const rawWechat = settings?.wechatQrCode?.trim();
      if (rawWechat) {
        if (rawWechat.startsWith('data:image/png;base64,') && !rawWechat.includes('ID.17') && !rawWechat.includes('svg')) {
          setWechatClean(rawWechat);
        } else {
          try {
            const clean = await cleanAndRegenerate(rawWechat, 'wechat');
            setWechatClean(clean);
          } catch (e) {
            setWechatClean(rawWechat);
          }
        }
      } else {
        setWechatClean('');
      }

      // 2. Alipay
      const rawAlipay = settings?.alipayQrCode?.trim();
      if (rawAlipay) {
        if (rawAlipay.startsWith('data:image/png;base64,') && !rawAlipay.includes('ID.17') && !rawAlipay.includes('svg')) {
          setAlipayClean(rawAlipay);
        } else {
          try {
            const clean = await cleanAndRegenerate(rawAlipay, 'alipay');
            setAlipayClean(clean);
          } catch (e) {
            setAlipayClean(rawAlipay);
          }
        }
      } else {
        setAlipayClean('');
      }
      
      setIsProcessing(false);
    };

    processQrs();
  }, [settings?.wechatQrCode, settings?.alipayQrCode]);

  const handleConfirmPayment = () => {
    onFinishTrip(trip.calculatedTotalFee);
  };

  if (showValetFeePayment) {
    return (
      <MerchantValetPaymentView
        trip={trip}
        settings={settings}
        wechatClean={wechatClean}
        onNavigateBack={() => setShowValetFeePayment(false)}
        onFinishTrip={onFinishTrip}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between h-full bg-[#F8FAFC] text-[#333333] select-none font-sans overflow-hidden">
      {/* HEADER */}
      <header className="bg-[#3B4257] text-white px-4 header-safe-pt pb-2.5 flex items-center justify-between sticky top-0 z-50 shrink-0">
        <div className="flex items-center">
          <button 
            type="button"
            onClick={onNavigateBack}
            aria-label="返回" 
            className="p-1 active:opacity-75 transition-opacity"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
            </svg>
          </button>
        </div>
        <h1 className="text-base font-medium">确认收费方式</h1>
        <div className="text-xs font-light opacity-90">
          <button 
            onClick={onNavigateBack}
            className="active:opacity-70 transition-opacity"
          >
            订单详情
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col overflow-y-auto py-1">
        <section className="bg-[#E9F9F8] px-5 py-3 flex justify-between items-center relative overflow-hidden shrink-0 mx-3 rounded-2xl mb-1.5" data-purpose="service-status-banner">
          <div className="z-10 flex flex-col gap-0.5">
            <h2 className="text-[#00A591] text-base sm:text-lg font-bold leading-tight">服务完成</h2>
            <h2 className="text-[#00A591] text-xs sm:text-sm font-medium leading-tight opacity-90">期待下次再见</h2>
          </div>
          <div className="relative flex items-center justify-end">
            <DriverIllustration size={56} className="relative z-10" />
          </div>
        </section>

        <section className="px-3 sm:px-4 my-auto py-1">
          <div className="bg-white rounded-2xl p-4 sm:p-5 flex flex-col items-center shadow-[0_4px_20px_rgba(0,0,0,0.05)] w-full max-w-xs mx-auto border border-gray-100/80">
            <div className="flex items-baseline gap-1 mb-1" data-purpose="price-display">
              <span className="text-base font-semibold text-gray-600">共</span>
              <span className="text-4xl sm:text-5xl font-black tracking-tight font-mono text-gray-950">
                {trip.calculatedTotalFee.toFixed(2)}
              </span>
              <span className="text-base font-semibold text-gray-600">元</span>
            </div>
            
            <p className="text-gray-500 text-xs mb-3">客人扫码支付，支持微信/支付宝</p>
            
            <div className="w-full max-w-[170px] sm:max-w-[200px] aspect-square flex items-center justify-center shrink-0 mb-3 animate-in fade-in zoom-in-95" data-purpose="qr-code-display">
              {isWechat ? (
                settings?.wechatQrCode && settings.wechatQrCode.trim() !== '' ? (
                  wechatClean ? (
                    <img src={wechatClean} alt="微信收款码" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100/50 rounded-lg animate-pulse text-gray-400 text-xs text-center font-semibold">
                      ⏳ 正在载入微信收款码...
                    </div>
                  )
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50/90 text-gray-600 text-center px-3 py-3 border-2 border-dashed border-gray-300 rounded-2xl shadow-inner gap-1.5">
                    <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 border border-amber-200 shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-gray-800">请在设置里上传收款码</span>
                    <span className="text-[10px] sm:text-[11px] text-gray-400 font-normal">首页 ➔ 设置 ➔ 上传微信收款码</span>
                  </div>
                )
              ) : (
                settings?.alipayQrCode && settings.alipayQrCode.trim() !== '' ? (
                  alipayClean ? (
                    <img src={alipayClean} alt="支付宝收款码" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100/50 rounded-lg animate-pulse text-gray-400 text-xs text-center font-semibold">
                      ⏳ 正在载入支付宝收款码...
                    </div>
                  )
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50/90 text-gray-600 text-center px-3 py-3 border-2 border-dashed border-gray-300 rounded-2xl shadow-inner gap-1.5">
                    <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 border border-amber-200 shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-gray-800">请在设置里上传收款码</span>
                    <span className="text-[10px] sm:text-[11px] text-gray-400 font-normal">首页 ➔ 设置 ➔ 上传支付宝收款码</span>
                  </div>
                )
              )}
            </div>

            {isWechat ? (
              <div className="flex flex-col items-center w-full mt-0.5">
                <div className="flex items-center gap-1.5 mb-1.5" data-purpose="active-payment-method">
                  <svg fill="none" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C6.477 2 2 6.015 2 10.97c0 2.81 1.442 5.315 3.69 6.963l-.46 1.72a.5.5 0 0 0 .668.59l2.12-.96c1.233.454 2.585.717 3.982.717 5.523 0 10-4.015 10-10.97C22 6.015 17.523 2 12 2z" fill="#07C160"></path>
                    <path d="M7.5 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" fill="white"></path>
                  </svg>
                  <span className="text-gray-800 text-xs sm:text-sm font-bold">微信支付</span>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsWechat(false)}
                  className="flex items-center gap-1.5 px-5 py-1.5 border border-[#00A591] text-[#00A591] rounded-xl text-xs font-semibold active:bg-[#F0FBFA] hover:bg-[#F0FBFA]/50 transition-colors cursor-pointer" 
                  data-purpose="switch-payment-action"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                  </svg>
                  切换支付宝收款
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full mt-0.5">
                <div className="flex items-center gap-1.5 mb-1.5" data-purpose="active-payment-method">
                  <svg fill="none" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
                    <rect width="24" height="24" rx="12" fill="#108EE9"/>
                    <text x="12" y="16.5" fill="white" fontSize="14" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">支</text>
                  </svg>
                  <span className="text-gray-800 text-xs sm:text-sm font-bold">支付宝支付</span>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsWechat(true)}
                  className="flex items-center gap-1.5 px-5 py-1.5 border border-[#108EE9] text-[#108EE9] rounded-xl text-xs font-semibold active:bg-[#F0F7FB] hover:bg-[#F0F7FB]/50 transition-colors cursor-pointer" 
                  data-purpose="switch-payment-action"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                  </svg>
                  切换微信收款
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FOOTER */}
      <footer className="p-4 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),var(--android-nav-bar-height,0px),28px))] bg-white sm:bg-transparent shrink-0 android-nav-safe-pb">
        <button 
          type="button"
          onClick={handleConfirmPayment}
          className="w-full py-3 bg-[#3B4257] text-white text-base font-medium rounded-lg shadow-md active:bg-[#2D3344] hover:bg-[#2D3344] transition-all cursor-pointer" 
          data-purpose="confirm-payment-button"
        >
          我已收款，返回首页
        </button>
      </footer>
    </div>
  );
}
