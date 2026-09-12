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
