import React, { useEffect, useState } from 'react';
import { IS_STORE_BUILD } from '../lib/channel';
import {
  registerPermissionPurposeUi,
  confirmPermissionPurpose,
  hasPermissionPurposeConsent,
} from '../utils/storePermissionGate';

// 商店版（华为审核版）权限用途说明弹窗：首次申请敏感权限前展示，
// 说明权限名称、服务的具体功能与用途，不自动消失、无关闭按钮，
// 用户点「知道了，继续」后才继续触发系统权限弹窗（审核指南 7.18）。
// 司机版不渲染本组件（IS_STORE_BUILD 为假时直接返回 null）。
export default function StorePermissionPurpose() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!IS_STORE_BUILD) return;
    registerPermissionPurposeUi(() => {
      if (!hasPermissionPurposeConsent()) setVisible(true);
    });
  }, []);

  if (!IS_STORE_BUILD || !visible) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-5">
      <div className="w-full max-w-[340px] bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5 space-y-3">
          <h3 className="text-base font-extrabold text-slate-800 text-center">权限申请说明</h3>
          <div className="text-[13px] text-slate-600 leading-relaxed space-y-2">
            <p>
              <b className="text-slate-800">位置权限：</b>
              用于接收附近订单派单、展示附近司机、计算接单距离与行程导航；行程中与听单状态下会在后台持续上报位置，以便系统为您派单。您可以在系统设置中随时关闭，关闭后将无法接单。
            </p>
            <p>
              <b className="text-slate-800">通知权限：</b>
              用于新订单到达、订单状态变化时及时提醒您，避免错过订单。
            </p>
            <p>接下来系统将弹出权限申请框，请您根据需要选择是否允许。</p>
          </div>
        </div>
        <div className="border-t border-gray-100">
          <button
            onClick={() => {
              setVisible(false);
              confirmPermissionPurpose();
            }}
            className="w-full h-12 text-sm font-bold text-white bg-teal-600 active:bg-teal-700 cursor-pointer"
          >
            知道了，继续
          </button>
        </div>
      </div>
    </div>
  );
}
