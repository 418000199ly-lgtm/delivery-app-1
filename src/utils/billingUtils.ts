import { BillingRules, TimeSlot, DEFAULT_SLOTS } from '../types';

/**
 * Parses "HH:mm" time string into minutes from midnight (0..1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

/**
 * Determines whether a given time (in minutes from midnight) falls within a slot.
 * Handles normal intervals (e.g. 06:00 - 18:59) and overnight intervals (e.g. 19:00 - 05:59).
 */
export function isTimeInSlot(currentMinutes: number, startTimeStr: string, endTimeStr: string): boolean {
  const startMin = parseTimeToMinutes(startTimeStr);
  const endMin = parseTimeToMinutes(endTimeStr);

  if (startMin <= endMin) {
    // Standard interval within the same calendar day (e.g., 06:00 to 18:59)
    return currentMinutes >= startMin && currentMinutes <= endMin;
  } else {
    // Cross-midnight interval (e.g., 19:00 to 05:59 or 23:00 to 06:00)
    return currentMinutes >= startMin || currentMinutes <= endMin;
  }
}

/**
 * Finds the matching billing TimeSlot for a given date/timestamp.
 * Accurate down to the minute (e.g. 18:59 vs 19:00).
 */
export function getTimeSlotForTime(rules?: BillingRules | null, targetTime?: number | Date | null): TimeSlot {
  const slots = (rules && Array.isArray(rules.slots) && rules.slots.length > 0)
    ? rules.slots
    : DEFAULT_SLOTS;

  const dateObj = targetTime
    ? (typeof targetTime === 'number' ? new Date(targetTime) : targetTime)
    : new Date();

  const totalMinutes = dateObj.getHours() * 60 + dateObj.getMinutes();

  let matchedSlot: TimeSlot = slots[0] || DEFAULT_SLOTS[0];

  for (const slot of slots) {
    if (!slot || !slot.startTime || !slot.endTime) continue;
    if (isTimeInSlot(totalMinutes, slot.startTime, slot.endTime)) {
      matchedSlot = slot;
      break;
    }
  }

  return matchedSlot;
}

export interface TripCostResult {
  base: number;
  total: number;
  distanceCost: number;
  returnFee: number;
  waitingFee: number;
  activeSlot: TimeSlot;
}

/**
 * Calculates trip cost strictly respecting the order's start time:
 * - The starting price (起步价) is locked based on the order's start timestamp.
 *   For example, an order started at 18:59 locks to the 06:00-18:59 slot (¥38).
 *   When the clock ticks to 19:00, the starting price remains ¥38 and does not jump to ¥40.
 * - Same applies to distance allowance and unit rates defined by that locked start slot.
 */
export function calculateOrderTripCost(
  dist: number,
  waitMinutes: number,
  rules?: BillingRules | null,
  orderStartTimestamp?: number | null,
  weatherMultiplier = 1.0,
  prelockedBaseFee?: number | null
): TripCostResult {
  const activeSlot = getTimeSlotForTime(rules, orderStartTimestamp);

  // If a pre-locked base fee was explicitly set on the trip, honor it; otherwise use activeSlot's startingPrice
  const basePriceCandidate = (typeof prelockedBaseFee === 'number' && prelockedBaseFee > 0)
    ? (prelockedBaseFee / (weatherMultiplier || 1.0))
    : (activeSlot?.startingPrice ?? 40);

  const base = basePriceCandidate;
  const freeKm = activeSlot?.includedDistance ?? 7;
  const interval = activeSlot?.distanceInterval || 1;
  const increase = activeSlot?.priceIncrease ?? activeSlot?.unitPricePerKm ?? 5;

  let distanceCost = 0;
  if (dist > freeKm) {
    distanceCost = Math.ceil((dist - freeKm) / interval) * increase;
  }

  // Return trip surcharge
  let returnFee = 0;
  const safeRules: Partial<BillingRules> = rules || { returnFeeStartKm: 0, returnFeePerKm: 0, freeWaitingTime: 10, waitingChargePerMin: 1 };
  if ((safeRules.returnFeeStartKm ?? 0) > 0 && dist > (safeRules.returnFeeStartKm ?? 0)) {
    const rInterval = safeRules.returnFeeIntervalKm || 1;
    const rIncrease = safeRules.returnFeeIncreaseYuan ?? safeRules.returnFeePerKm ?? 0;
    returnFee = Math.ceil((dist - (safeRules.returnFeeStartKm ?? 0)) / rInterval) * rIncrease;
  }

  // Waiting surcharge
  let waitingFee = 0;
  const freeWait = safeRules.freeWaitingTime ?? 10;
  if (waitMinutes > freeWait) {
    const wInterval = safeRules.waitingIntervalMin || 1;
    const wIncrease = safeRules.waitingIncreaseYuan ?? safeRules.waitingChargePerMin ?? 0;
    waitingFee = Math.ceil((waitMinutes - freeWait) / wInterval) * wIncrease;
  }

  const wMult = weatherMultiplier || 1.0;
  const totalCalculated = (base + distanceCost + returnFee + waitingFee) * wMult;

  return {
    base: Number((base * wMult).toFixed(2)),
    total: Number(totalCalculated.toFixed(2)),
    distanceCost: Number((distanceCost * wMult).toFixed(2)),
    returnFee: Number((returnFee * wMult).toFixed(2)),
    waitingFee: Number((waitingFee * wMult).toFixed(2)),
    activeSlot
  };
}

export interface OrderCostBreakdown {
  startFee: number;
  totalKm: number;
  totalKmStr: string;
  distFee: number;
  totalWaitMin: number;
  waitFee: number;
  extraFee: number;
  totalAmount: number;
}

/**
 * 订单费用明细统一计算（2026-10-18定版，2026-11-12自 OrderDetailModal 迁入此处以便单测）：
 * 起步价（司机设置的时段起步价，即订单锁定的 calculatedBaseFee/startPrice）
 * + 里程费（只收超出起步含公里的部分）+ 等候费 + 返程/附加费；
 * 订单总计恒等于四项之和。报单、二维码创单、商户代叫、报单转单四类订单共用同一口径。
 */
export function computeOrderCostBreakdown(order: any, billingRules?: BillingRules): OrderCostBreakdown {
  // Accurate order start time resolution: timestamp or timeStr
  let orderDate: Date = new Date();
  if (order.startTimestamp || order.timestamp) {
    orderDate = new Date(Number(order.startTimestamp || order.timestamp));
  } else {
    const orderTimeStr = order.timeStr || order.fullTimeStr || '';
    const timeMatch = orderTimeStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      orderDate = new Date(
        parseInt(timeMatch[1], 10),
        parseInt(timeMatch[2], 10) - 1,
        parseInt(timeMatch[3], 10),
        parseInt(timeMatch[4], 10),
        parseInt(timeMatch[5], 10)
      );
    } else {
      const hmMatch = orderTimeStr.match(/(\d{1,2}):(\d{2})/);
      if (hmMatch) {
        orderDate = new Date();
        orderDate.setHours(parseInt(hmMatch[1], 10), parseInt(hmMatch[2], 10), 0, 0);
      }
    }
  }

  const activeSlot = getTimeSlotForTime(billingRules, orderDate);

  // 1. 起步价: 优先使用订单创建/锁定的起步价（calculatedBaseFee / startPrice）
  const ruleStartPrice = activeSlot?.startingPrice ?? 38.00;
  let startFee = Number(order.calculatedBaseFee || order.startPrice || ruleStartPrice);

  // 2. 里程解析与真实自动计算
  let totalKm = Number(order.distance ?? order.currentDistance ?? order.tripDistance ?? 0);
  if (totalKm <= 0) {
    if (order.routeDistance && Number(order.routeDistance) > 0) {
      totalKm = Number(order.routeDistance);
    } else if (order.estimatedDistance && Number(order.estimatedDistance) > 0) {
      totalKm = Number(order.estimatedDistance);
    } else if (order.distanceText && typeof order.distanceText === 'string') {
      const numMatch = order.distanceText.match(/(\d+(\.\d+)?)/);
      if (numMatch) totalKm = parseFloat(numMatch[1]);
    }
  }

  const includedKm = activeSlot?.includedDistance ?? 7;
  const distInterval = activeSlot?.distanceInterval || 1;
  const distUnitPrice = activeSlot?.priceIncrease ?? activeSlot?.unitPricePerKm ?? 5;

  let distFee = 0;
  if (order.distanceFee !== undefined && order.distanceFee !== null && Number(order.distanceFee) >= 0) {
    distFee = Number(order.distanceFee);
  } else if (totalKm > includedKm) {
    const extraKm = totalKm - includedKm;
    distFee = Math.ceil(extraKm / distInterval) * distUnitPrice;
  }

  // 3. 中途等候与等候费
  // 2026-10-18修：等候时间存的就是分钟（currentWaitingTime=wMins），旧逻辑 rawWait>60 时除以60，
  // 导致90分钟显示成1分钟。直接按分钟取整。
  const rawWait = Number(order.currentWaitingTime ?? order.waitTime ?? order.waitingTime ?? 0);
  const totalWaitMin = Math.max(0, Math.round(rawWait));
  const freeWaitMin = billingRules?.freeWaitingTime ?? 10;
  const waitInterval = billingRules?.waitingIntervalMin || 1;
  const waitUnitPrice = billingRules?.waitingIncreaseYuan ?? billingRules?.waitingChargePerMin ?? 1;

  let waitFee = 0;
  if (order.waitFee !== undefined && order.waitFee !== null && Number(order.waitFee) >= 0) {
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
  if (order.returnFee !== undefined && order.returnFee !== null && Number(order.returnFee) >= 0) {
    returnFee = Number(order.returnFee);
  } else if (returnStartKm > 0 && totalKm > returnStartKm) {
    const extraReturnKm = totalKm - returnStartKm;
    returnFee = Math.ceil(extraReturnKm / returnInterval) * returnUnitPrice;
  }

  const extraSum = Number(order.extraBridgeFee || 0) +
                   Number(order.extraParkingFee || 0) +
                   Number(order.extraOtherFee || 0);
  const extraFee = returnFee + extraSum;

  // 5. 存量污染修复（2026-11-12）：旧版完单链路把总价误写进 calculatedBaseFee
  // （如真实起步40、总价55，却存成起步价55、里程费15），直接相加会双算成70。
  // 指纹：订单里真存了起步价字段，且它恰好等于「实收总额 − 垫付附加费」，同时四项之和 ≠ 实收。
  // 命中时按实收反推真实起步价（实收 − 里程 − 等候 − 返程/附加），保证详情与实收一致。
  // 新单已在源头（ActiveTripView/App.handleEndTrip）修复，不会再产生这种记录；此处只治存量。
  const storedTotal = Number(order.amount ?? order.calculatedTotalFee ?? 0);
  const storedBaseRaw = order.calculatedBaseFee ?? order.startPrice;
  if (storedTotal > 0 && storedBaseRaw !== undefined && storedBaseRaw !== null) {
    const sumBefore = Number((startFee + distFee + waitFee + extraFee).toFixed(2));
    if (Math.abs(sumBefore - storedTotal) > 0.005 &&
        Math.abs(Number(storedBaseRaw) - (storedTotal - extraSum)) < 0.005) {
      const derivedBase = Number((storedTotal - distFee - waitFee - extraFee).toFixed(2));
      if (derivedBase > 0) {
        startFee = derivedBase;
      }
    }
  }

  // 6. 订单总计：恒等于四项之和（起步价+里程费+等候费+返程/附加费）
  const totalAmount = Number((startFee + distFee + waitFee + extraFee).toFixed(2));

  const totalKmStr = totalKm > 0 ? (totalKm % 1 === 0 ? totalKm.toFixed(0) : totalKm.toFixed(1)) : "0.0";

  return { startFee, totalKm, totalKmStr, distFee, totalWaitMin, waitFee, extraFee, totalAmount };
}
