import React, { useState } from 'react';
import PrivacyPolicyContent from './PrivacyPolicyContent';

// 首启隐私同意弹窗（2026-11-17，上架合规）：首次打开 App 先展示，
// 用户点「同意并继续」后才可进入登录/接单流程（定位等能力均在登录后才启动）。
export default function PrivacyConsentGate({ onAgree }: { onAgree: () => void }) {
  const [showFull, setShowFull] = useState(false);
  const [declined, setDeclined] = useState(false);

  if (showFull) {
    return (
      <div className="fixed inset-0 z-[300] bg-slate-50 flex flex-col">
        <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center px-4 text-white shadow-md shrink-0">
          <button
            onClick={() => setShowFull(false)}
            className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-colors flex items-center"
          >
            <span className="text-sm font-medium">‹ 返回</span>
          </button>
          <span className="font-semibold text-base tracking-wide text-center flex-1 pr-12 text-gray-100">隐私政策</span>
        </div>
        <div className="flex-1 overflow-y-auto p-5 pb-10">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs">
            <PrivacyPolicyContent />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-5">
      <div className="w-full max-w-[340px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5 space-y-3">
          <h3 className="text-base font-extrabold text-slate-800 text-center">隐私政策提示</h3>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            欢迎使用黑湾代驾MAX。为了向您提供接单、派单服务，我们需要收集您的手机号码、位置信息、订单与行程信息、收款二维码等必要信息，具体用途与保护方式请阅读
            <button onClick={() => setShowFull(true)} className="text-teal-600 font-semibold">《隐私政策》</button>
            。点击「同意并继续」即表示您已阅读并同意该政策；不同意将无法使用本应用。
          </p>
          {declined && (
            <p className="text-[12px] text-red-500 leading-relaxed text-center">
              如不同意隐私政策，将无法使用本应用的登录与接单服务。
            </p>
          )}
        </div>
        <div className="flex border-t border-gray-100">
          <button
            onClick={() => setDeclined(true)}
            className="flex-1 h-12 text-sm font-semibold text-slate-500 active:bg-gray-50 cursor-pointer"
          >
            不同意
          </button>
          <button
            onClick={onAgree}
            className="flex-1 h-12 text-sm font-bold text-white bg-teal-600 active:bg-teal-700 cursor-pointer"
          >
            同意并继续
          </button>
        </div>
      </div>
    </div>
  );
}
