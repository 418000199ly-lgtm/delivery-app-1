import React, { useState } from 'react';
import { ArrowLeft, Landmark, Car, HelpCircle, Flame, X } from 'lucide-react';
import { TripState, BillingRules, ChauffeurSettings, checkVipActive } from '../types';

interface TripCostViewProps {
  trip: TripState;
  settings?: ChauffeurSettings;
  billingRules: BillingRules;
  onNavigateBack: () => void;
  onGoToCollection: (updatedTrip: TripState) => void;
}

export default function TripCostView({
  trip,
  settings,
  billingRules,
  onNavigateBack,
  onGoToCollection
}: TripCostViewProps) {
  // Modal state
  const [showRulesModal, setShowRulesModal] = useState(false);

  const isVip = checkVipActive(settings?.vipExpiry);

  // Input binders for extra pad fees (Screenshot 1: 高速费, 停车费, 其他费用)
  const [bridgeFeeStr, setBridgeFeeStr] = useState('');
  const [parkingFeeStr, setParkingFeeStr] = useState('');
  const [otherFeeStr, setOtherFeeStr] = useState('');

  // Number converters
  const bridgeFee = isVip ? (Number(bridgeFeeStr) || 0) : 0;
  const parkingFee = isVip ? (Number(parkingFeeStr) || 0) : 0;
  const otherFee = isVip ? (Number(otherFeeStr) || 0) : 0;

  // Real-time calculated Grand Total
  const grandTotal = Number((trip.calculatedBaseFee + bridgeFee + parkingFee + otherFee).toFixed(2));

  const handleProceed = () => {
    // Commit the inputs and progress
    const finalizedTripState: TripState = {
      ...trip,
      extraBridgeFee: bridgeFee,
      extraParkingFee: parkingFee,
      extraOtherFee: otherFee,
      calculatedTotalFee: grandTotal,
      currentStatus: 'payment_pending'
    };
    onGoToCollection(finalizedTripState);
  };

  return (
    <div className="flex-1 flex flex-col justify-between h-full bg-slate-100 select-none">
      
      {/* 1. Top Bar Navigation Panel */}
      <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md z-10">
        <button 
          onClick={onNavigateBack}
          className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-colors flex items-center"
        >
          <ArrowLeft className="w-5 h-5 text-gray-100" />
        </button>
        <span className="font-semibold text-base tracking-wide text-center flex-1 pr-6 text-gray-100">行程结束</span>
        <div></div>
      </div>

      {/* Main calculation summary card container */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        
        {/* Base invoice stats card */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs text-center relative overflow-hidden">
          
          <div className="text-gray-500 text-[13px] font-medium mb-1 tracking-wide font-sans">
            行程费用
          </div>

          {/* Big Currency Fee number (matching Screenshot 1: 40.00元) */}
          <div className="text-5xl font-extrabold text-[#1DA39B] my-3 font-sans flex items-center justify-center">
            <span>{grandTotal.toFixed(2)}</span>
            <span className="text-xl font-bold ml-1.5 align-bottom">元</span>
          </div>

          {/* Slices of summary stats in grid row */}
          <div className="flex items-center justify-center space-x-2.5 text-xs text-gray-500 border-t border-gray-50 pt-4 mt-2">
            <span>全程 <strong className="text-gray-800 font-bold">{trip.currentDistance.toFixed(2)}</strong> 公里</span>
            <span className="text-gray-300">|</span>
            <span>等候 <strong className="text-gray-800 font-bold">{trip.currentWaitingTime}</strong> 分钟</span>
            <span className="text-gray-300">|</span>
            <span 
              onClick={() => setShowRulesModal(true)}
              className="text-[#1DA39B] font-semibold cursor-pointer hover:underline flex items-center space-x-0.5 select-none"
            >
              <span>计费规则</span>
              <span className="text-[10px]">▶</span>
            </span>
          </div>
        </div>

        {/* 3 extra expenses prompt and form inputs */}
        <div className="space-y-3">
          <div className="text-xs text-gray-500 font-semibold px-1.5 flex items-center space-x-1.5 border-l-4 border-[#1DA39B]">
            <span>填写您自己垫付的额外费用</span>
          </div>

          <div className="space-y-3">
            
            {/* 1. Bridge Fee input */}
            <div 
              onClick={() => {
                if (!isVip) {
                  alert('🔒 提示：垫付费用（路桥费、停车费、其他费用）属于VIP专属高级特权功能。您当前非VIP会员或会员已到期，请先激活VIP。');
                }
              }}
              className={`bg-white rounded-2xl border border-gray-100 px-4 py-3.5 flex items-center justify-between shadow-xs ${!isVip ? 'opacity-65 cursor-not-allowed' : ''}`}
            >
              <span className="text-sm font-bold text-gray-800">高速费/路桥费</span>
              <div className={`flex items-center border border-gray-100 rounded-xl px-3 py-1.5 shadow-inner ${!isVip ? 'bg-slate-100' : 'bg-slate-50'}`}>
                <input
                  type="text"
                  pattern="[0-9]*"
                  placeholder={isVip ? "请输入金额" : "🔒 仅限VIP"}
                  disabled={!isVip}
                  value={isVip ? bridgeFeeStr : ""}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setBridgeFeeStr(val);
                  }}
                  className="w-24 text-right bg-transparent text-sm font-semibold focus:outline-hidden text-gray-900 placeholder-gray-400 disabled:text-gray-400 disabled:cursor-not-allowed"
                />
                <span className="text-xs text-gray-400 ml-1.5 font-bold">元</span>
              </div>
            </div>

            {/* 2. Parking Fee input */}
            <div 
              onClick={() => {
                if (!isVip) {
                  alert('🔒 提示：垫付费用（路桥费、停车费、其他费用）属于VIP专属高级特权功能。您当前非VIP会员或会员已到期，请先激活VIP。');
                }
              }}
              className={`bg-white rounded-2xl border border-gray-100 px-4 py-3.5 flex items-center justify-between shadow-xs ${!isVip ? 'opacity-65 cursor-not-allowed' : ''}`}
            >
              <span className="text-sm font-bold text-gray-800">停车费</span>
              <div className={`flex items-center border border-gray-100 rounded-xl px-3 py-1.5 shadow-inner ${!isVip ? 'bg-slate-100' : 'bg-slate-50'}`}>
                <input
                  type="text"
                  pattern="[0-9]*"
                  placeholder={isVip ? "请输入金额" : "🔒 仅限VIP"}
                  disabled={!isVip}
                  value={isVip ? parkingFeeStr : ""}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setParkingFeeStr(val);
                  }}
                  className="w-24 text-right bg-transparent text-sm font-semibold focus:outline-hidden text-gray-900 placeholder-gray-400 disabled:text-gray-400 disabled:cursor-not-allowed"
                />
                <span className="text-xs text-gray-400 ml-1.5 font-bold">元</span>
              </div>
            </div>

            {/* 3. Other Fees input */}
            <div 
              onClick={() => {
                if (!isVip) {
                  alert('🔒 提示：垫付费用（路桥费、停车费、其他费用）属于VIP专属高级特权功能。您当前非VIP会员或会员已到期，请先激活VIP。');
                }
              }}
              className={`bg-white rounded-2xl border border-gray-100 px-4 py-3.5 flex items-center justify-between shadow-xs ${!isVip ? 'opacity-65 cursor-not-allowed' : ''}`}
            >
              <span className="text-sm font-bold text-gray-800">其他费用</span>
              <div className={`flex items-center border border-gray-100 rounded-xl px-3 py-1.5 shadow-inner ${!isVip ? 'bg-slate-100' : 'bg-slate-50'}`}>
                <input
                  type="text"
                  pattern="[0-9]*"
                  placeholder={isVip ? "请输入金额" : "🔒 仅限VIP"}
                  disabled={!isVip}
                  value={isVip ? otherFeeStr : ""}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setOtherFeeStr(val);
                  }}
                  className="w-24 text-right bg-transparent text-sm font-semibold focus:outline-hidden text-gray-900 placeholder-gray-400 disabled:text-gray-400 disabled:cursor-not-allowed"
                />
                <span className="text-xs text-gray-400 ml-1.5 font-bold">元</span>
              </div>
            </div>

          </div>

          {/* Subtitle helper showing math decomposition */}
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-[11px] text-amber-700 leading-relaxed">
            <span className="font-semibold block mb-0.5">费用结算明细计费：</span>
            <span>
              基础代驾 ¥{trip.calculatedBaseFee.toFixed(2)}
              {bridgeFee > 0 && ` + 过路 ¥${bridgeFee.toFixed(2)}`}
              {parkingFee > 0 && ` + 停车 ¥${parkingFee.toFixed(2)}`}
              {otherFee > 0 && ` + 其他 ¥${otherFee.toFixed(2)}`}
              {` = 应收结账合计 ¥${grandTotal.toFixed(2)} 元`}
            </span>
          </div>
        </div>

      </div>

      {/* Action triggers button at bottom */}
      <div className="p-4 bg-white border-t border-gray-200/60 shadow-lg select-none">
        <button
          onClick={handleProceed}
          className="w-full py-4 bg-[#1da39b] hover:bg-teal-600 text-white font-bold rounded-2xl shadow-xl shadow-teal-500/20 active:scale-98 transition-all text-center text-sm flex items-center justify-center space-x-1"
        >
          <span>去收款</span>
        </button>
      </div>

      {/* DETAILED BILLING RULES OVERVIEW MODAL */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-[320px] p-5 shadow-2xl border border-slate-100 text-left animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <span className="text-sm font-black text-slate-800">代驾规则与计费模版</span>
              <button 
                onClick={() => setShowRulesModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3.5 text-xs text-slate-600 mb-5 max-h-[300px] overflow-y-auto pr-1">
              <div>
                <span className="font-bold text-slate-800 block mb-0.5">模版名称</span>
                <p className="bg-teal-50 text-teal-800 rounded-md py-1 px-2.5 inline-block font-semibold">
                  {billingRules.templateName}
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">当前时间段计费</span>
                <ul className="space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed text-[11px]">
                  {billingRules.slots.map((slot, index) => (
                    <li key={index} className="flex justify-between">
                      <span>{slot.startTime}–{slot.endTime}</span>
                      <span className="font-bold text-slate-705">起步 ¥{slot.startingPrice} (含 {slot.includedDistance}km)</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">公里运价</span>
                {(() => {
                  const firstSlot = billingRules.slots[0];
                  const displayInterval = firstSlot.distanceInterval || 1;
                  const displayIncrease = firstSlot.priceIncrease ?? firstSlot.unitPricePerKm ?? 5;
                  return (
                    <p className="text-slate-500">
                      超出初始里程后，每增加 <span className="font-semibold text-slate-800">{displayInterval}</span> 公里需支付 <span className="font-bold text-teal-600">¥{displayIncrease} 元</span> 收款运价。
                    </p>
                  );
                })()}
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">等候计时计费</span>
                <p className="text-slate-500">
                  乘客前 <span className="font-bold text-teal-600">{billingRules.freeWaitingTime} 分钟</span> 免费等待。
                  超出后每过 <span className="font-semibold text-slate-800">{billingRules.waitingIntervalMin ?? 1}</span> 分钟加收 <span className="font-bold text-teal-600">¥{billingRules.waitingIncreaseYuan ?? billingRules.waitingChargePerMin} 元</span>。
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">返程收费准则</span>
                {billingRules.returnFeeStartKm > 0 ? (
                  <p className="text-slate-500">
                    行程里程超过 <span className="font-bold text-slate-800">{billingRules.returnFeeStartKm} 公里</span> 时，超公里部分每增加 <span className="font-bold text-teal-600">{billingRules.returnFeeIntervalKm || 1} 公里</span> 加收 <span className="font-bold text-teal-600">¥{(billingRules.returnFeeIncreaseYuan ?? billingRules.returnFeePerKm ?? 0)} 元</span>。
                  </p>
                ) : (
                  <p className="text-slate-500">无返程加收费用。</p>
                )}
              </div>
            </div>

            <button 
              onClick={() => setShowRulesModal(false)}
              className="w-full py-2.5 bg-[#3d465e] text-white hover:bg-[#343c51] rounded-xl text-xs font-bold transition-all"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
