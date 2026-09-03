import React, { useState } from 'react';
import { ArrowLeft, MoreVertical, CheckCircle2, Receipt, Route, Clock, User, Phone, Trash2, Send } from 'lucide-react';
import { BillingRules, DEFAULT_SLOTS } from '../types';
import { formatOrderDisplayTime } from './HomeView';

interface OrderDetailModalProps {
  order: any;
  billingRules?: BillingRules;
  onClose: () => void;
  onDeleteOrder?: (order: any) => void;
  toastNotice?: (msg: string) => void;
  onOpenMerchantValetPayment?: (trip: any) => void;
}

export default function OrderDetailModal({
  order,
  billingRules,
  onClose,
  onDeleteOrder,
  toastNotice,
  onOpenMerchantValetPayment
}: OrderDetailModalProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!order) return null;

  const rawP = (
    order.passengerPhone || 
    order.phone || 
    order.rawPhone || 
    ''
  ).toString().trim();

  const displayPhone = (rawP && rawP !== '未填写' && rawP !== '无' && rawP !== 'undefined') 
    ? rawP 
    : '无';

  const handleTriggerToast = (msg: string) => {
    if (toastNotice) {
      toastNotice(msg);
    } else {
      alert(msg);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#f0f9f4] dark:bg-zinc-950 z-[1200] flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 select-none">
      {/* Header */}
      <header className="sticky top-0 w-full z-50 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between px-4 h-14 shrink-0">
        <button 
          type="button"
          onClick={onClose} 
          aria-label="返回" 
          className="text-[#984800] dark:text-amber-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors p-2 rounded-full -ml-2 active:opacity-80 cursor-pointer"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-[#984800] dark:text-amber-500">订单详情</h1>
        <button 
          type="button"
          aria-label="更多" 
          className="text-[#984800] dark:text-amber-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors p-2 rounded-full -mr-2 active:opacity-80 cursor-pointer"
        >
          <MoreVertical className="w-6 h-6" />
        </button>
      </header>

      {/* Scrollable Container */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Status Header */}
        <div className="flex flex-col items-center justify-center pt-2 pb-2">
          <div className="w-20 h-20 rounded-full bg-[#ff7d00]/10 flex items-center justify-center mb-2">
            <CheckCircle2 className="w-10 h-10 text-[#ff7d00]" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1">已完成</h2>
          <p className="text-2xl font-bold text-[#ff7d00]">
            ¥ {Number(order.amount ?? order.calculatedTotalFee ?? 38).toFixed(2)}
          </p>
        </div>

        {/* 费用明细卡片 */}
        {(() => {
          const slots = (billingRules && Array.isArray(billingRules.slots) && billingRules.slots.length > 0)
            ? billingRules.slots
            : DEFAULT_SLOTS;

          let orderHour = new Date().getHours();
          const orderTimeStr = order.timeStr || order.fullTimeStr || '';
          const timeMatch = orderTimeStr.match(/(\d{1,2}):(\d{2})/);
          if (timeMatch) {
            orderHour = parseInt(timeMatch[1], 10);
          }

          let activeSlot = slots[0] || DEFAULT_SLOTS[0];
          for (const slot of slots) {
            if (!slot || !slot.startTime || !slot.endTime) continue;
            const [startH] = slot.startTime.split(':').map(Number);
            const [endH] = slot.endTime.split(':').map(Number);
            
            if (startH > endH) {
              if (orderHour >= startH || orderHour <= endH) {
                activeSlot = slot;
                break;
              }
            } else if (orderHour >= startH && orderHour <= endH) {
              activeSlot = slot;
              break;
            }
          }

          // 1. 起步价
          const ruleStartPrice = activeSlot?.startingPrice ?? 38.00;
          const startFee = Number(order.calculatedBaseFee || order.startPrice || ruleStartPrice);

          // 2. 里程与里程费
          const totalKm = Number(order.distance ?? order.currentDistance ?? order.tripDistance ?? 0);
          const totalKmStr = totalKm > 0 ? (totalKm % 1 === 0 ? totalKm.toFixed(0) : totalKm.toFixed(1)) : "0";
          const includedKm = activeSlot?.includedDistance ?? 7;
          const distInterval = activeSlot?.distanceInterval || 1;
          const distUnitPrice = activeSlot?.priceIncrease ?? activeSlot?.unitPricePerKm ?? 5;

          let distFee = 0;
          if (order.distanceFee !== undefined && order.distanceFee !== null) {
            distFee = Number(order.distanceFee);
          } else if (totalKm > includedKm) {
            const extraKm = totalKm - includedKm;
            distFee = Math.ceil(extraKm / distInterval) * distUnitPrice;
          }

          // 3. 中途等候与等候费
          const rawWait = Number(order.currentWaitingTime ?? order.waitTime ?? order.waitingTime ?? 0);
          const totalWaitMin = rawWait > 60 ? Math.floor(rawWait / 60) : Math.round(rawWait);
          const freeWaitMin = billingRules?.freeWaitingTime ?? 10;
          const waitInterval = billingRules?.waitingIntervalMin || 1;
          const waitUnitPrice = billingRules?.waitingIncreaseYuan ?? billingRules?.waitingChargePerMin ?? 1;

          let waitFee = 0;
          if (order.waitFee !== undefined && order.waitFee !== null) {
            waitFee = Number(order.waitFee);
          } else if (totalWaitMin > freeWaitMin) {
            const extraWait = totalWaitMin - freeWaitMin;
            waitFee = Math.ceil(extraWait / waitInterval) * waitUnitPrice;
          }

          // 4. 返程/附加费
          const returnStartKm = billingRules?.returnFeeStartKm ?? 0;
          const returnInterval = billingRules?.returnFeeIntervalKm || 1;
          const returnUnitPrice = billingRules?.returnFeeIncreaseYuan ?? billingRules?.returnFeePerKm ?? 0;

          let returnFee = 0;
          if (order.returnFee !== undefined && order.returnFee !== null) {
            returnFee = Number(order.returnFee);
          } else if (returnStartKm > 0 && totalKm > returnStartKm) {
            const extraReturnKm = totalKm - returnStartKm;
            returnFee = Math.ceil(extraReturnKm / returnInterval) * returnUnitPrice;
          }

          const extraSum = Number(order.extraBridgeFee || 0) + 
                           Number(order.extraParkingFee || 0) + 
                           Number(order.extraOtherFee || 0);
          let extraFee = returnFee + extraSum;

          // 5. 订单总计
          let totalAmount = startFee + distFee + waitFee + extraFee;
          if (order.amount !== undefined && order.amount !== null) {
            totalAmount = Number(order.amount);
          } else if (order.calculatedTotalFee !== undefined && order.calculatedTotalFee !== null) {
            totalAmount = Number(order.calculatedTotalFee);
          }

          const sumFour = startFee + distFee + waitFee + extraFee;
          if (Math.abs(sumFour - totalAmount) > 0.01 && order.distanceFee === undefined) {
            const diff = totalAmount - sumFour;
            if (extraFee + diff >= 0) {
              extraFee = Number((extraFee + diff).toFixed(2));
            }
          }

          return (
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#ff7d00]" />
                费用明细
              </h3>
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span>起步价</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">¥ {startFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span>里程 ({totalKmStr} 公里)</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">¥ {distFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span>中途等候 ({totalWaitMin} 分钟)</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">¥ {waitFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span>返程/附加费</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">¥ {extraFee.toFixed(2)}</span>
                </div>
              </div>
              <hr className="border-slate-100 dark:border-zinc-800 my-4" />
              <div className="flex justify-between items-center">
                <span className="text-slate-800 dark:text-slate-200 font-bold text-base">订单总计</span>
                <span className="text-[#ff7d00] text-xl font-extrabold">
                  ¥ {totalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })()}

        {/* 行程信息卡片 */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
            <Route className="w-5 h-5 text-[#ff7d00]" />
            行程信息
          </h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-400 font-semibold">订单时间</span>
                <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                  {formatOrderDisplayTime(order)}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-semibold">客户电话</span>
                  <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                    {displayPhone}
                  </span>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => {
                  if (displayPhone !== '无') {
                    window.location.href = `tel:${displayPhone}`;
                  } else {
                    handleTriggerToast('无手机号码');
                  }
                }}
                aria-label="拨打客户电话"
                className="bg-[#ff7d00]/10 text-[#ff7d00] rounded-full p-2 hover:bg-[#ff7d00]/20 active:scale-95 transition-all cursor-pointer"
              >
                <Phone className="w-5 h-5" />
              </button>
            </div>

            {/* 补发代叫费按钮 */}
            {(() => {
              const t = (order.type || order.orderType || '').trim();
              const r = (order.orderRemark || order.remark || '').trim();
              const m = (order.merchantName || order.source || '').trim();
              const dest = (order.endLocation || order.destination || '').trim();
              const isReportTransfer = (
                t === '报单转单' ||
                r === '报单转单' ||
                m === '报单转单' ||
                dest.includes('报单转单') ||
                order.isReportTransferOrder ||
                order.isReportTransfer ||
                order.isReportTransferValet
              );
              const isMerchantValet = (
                !isReportTransfer && (
                  r === '商户代叫' ||
                  t === '商户代叫' ||
                  t === '商户代叫订单' ||
                  t === '后台指派订单' ||
                  order.isMerchantValetOrder
                )
              );
              if ((isReportTransfer || isMerchantValet) && onOpenMerchantValetPayment) {
                return (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenMerchantValetPayment(order);
                        onClose();
                      }}
                      className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-[0.98] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                    >
                      <Send className="w-4 h-4 text-white" />
                      <span>补发代叫费</span>
                    </button>
                  </div>
                );
              }
              return null;
            })()}

            <div className="relative pl-7 pt-2">
              <div className="absolute left-[13px] top-[18px] bottom-6 w-0.5 bg-slate-200 dark:bg-zinc-800"></div>
              <div className="flex items-start gap-2 mb-4 relative">
                <div className="absolute -left-[28px] top-1 w-3 h-3 rounded-full bg-[#10B981] border-2 border-white dark:border-zinc-900"></div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-semibold">起点</span>
                  <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                    {order.startLocation || '北京东路（铂金大厦）'}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2 relative">
                <div className="absolute -left-[28px] top-1 w-3 h-3 rounded-full bg-[#EF4444] border-2 border-white dark:border-zinc-900"></div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-semibold">终点</span>
                  <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                    {order.endLocation || '盈北路'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 操作区 */}
        {onDeleteOrder && (
          <div className="pt-2 pb-6 flex justify-center">
            <button 
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-[#ba1a1a] bg-[#EEEEEE] dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-900/30 px-6 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center w-full transition-colors cursor-pointer active:scale-98 shadow-xs"
            >
              <Trash2 className="w-5 h-5 mr-2 text-[#ba1a1a]" />
              删除订单
            </button>
          </div>
        )}
      </main>

      {/* 删除确认 Modal */}
      {showDeleteConfirm && onDeleteOrder && (
        <div className="fixed inset-0 z-[1300] bg-black/60 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100 dark:border-zinc-800 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">删除订单</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">确定要删除这笔订单记录吗？删除后不可恢复。</p>
            </div>
            <div className="flex items-center space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 font-bold text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteOrder(order);
                  setShowDeleteConfirm(false);
                  onClose();
                }}
                className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-md transition-colors"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
