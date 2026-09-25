import { getBaseApiUrl } from '../lib/dbProxy';

function isPlaceholderPhone(phone: string): boolean {
  if (!phone) return true;
  const p = phone.trim();
  return (
    p.includes('匿名') ||
    p.includes('未填写') ||
    p.includes('代叫客户') ||
    p.includes('测试') ||
    p.length < 7
  );
}

/**
 * Validates whether an order has already been completed, finished, paid, or cancelled.
 * Checks local storage cache, driver order history, and remote database.
 */
export async function isOrderAlreadyEnded(order: any, userPhone?: string): Promise<boolean> {
  if (!order) return true;

  const orderId = (order.id || order.orderId || order.orderNo || order.orderNumber || '').toString().trim();
  const pPhone = (order.passengerPhone || order.phone || '').toString().trim();
  const startLoc = (order.startLocation || order.pickupName || '').toString().trim();

  // 1. Direct status flags on order object
  if (
    order.status === 'completed' ||
    order.status === 'cancelled' ||
    order.status === 'finished' ||
    order.status === 'paid' ||
    order.status === 'settled' ||
    order.isCompleted === true
  ) {
    return true;
  }

  const categoryStr = (order.statusCategory || '').toString();
  if (
    categoryStr.includes('已完成') ||
    categoryStr.includes('已取消') ||
    categoryStr.includes('已支付') ||
    categoryStr.includes('已结单')
  ) {
    return true;
  }

  // 2. Check local merchant orders cache (dd_merchant_orders_v2)
  if (typeof window !== 'undefined') {
    try {
      const savedMerchant = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
      if (Array.isArray(savedMerchant) && orderId) {
        const match = savedMerchant.find((o: any) =>
          o && (o.id === orderId || o.orderId === orderId || o.orderNo === orderId || o.orderNumber === orderId)
        );

        if (match) {
          const mStatus = (match.status || '').toString();
          const mCat = (match.statusCategory || '').toString();
          if (
            mStatus === 'completed' ||
            mStatus === 'cancelled' ||
            mStatus === 'finished' ||
            mStatus === 'paid' ||
            mCat.includes('已完成') ||
            mCat.includes('已取消') ||
            mCat.includes('已支付') ||
            mCat.includes('已结单')
          ) {
            return true;
          }
        }
      }
    } catch (_) {}

    // 3. Check driver completed orders history
    try {
      const cleanPhone = (userPhone || localStorage.getItem('dd_user_phone') || localStorage.getItem('dd_driver_phone') || '').replace(/\D/g, '');
      const storageKeys = cleanPhone ? [`dd_driver_orders_${cleanPhone}`, 'dd_driver_orders'] : ['dd_driver_orders'];

      if (orderId) {
        for (const key of storageKeys) {
          const historyRaw = localStorage.getItem(key);
          if (historyRaw) {
            const history = JSON.parse(historyRaw);
            if (Array.isArray(history)) {
              const matchHist = history.find((h: any) =>
                h && (h.id === orderId || h.orderId === orderId || h.orderNumber === orderId || h.orderNo === orderId)
              );

              if (matchHist) {
                return true;
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // 4. Remote API check to Baota / MySQL DB
  if (orderId && !orderId.match(/^1[3-9]\d{9}$/)) {
    try {
      const baseUrl = getBaseApiUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${baseUrl}/api/db/get?col=merchant_orders&id=${encodeURIComponent(orderId)}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json && json.data) {
          const data = json.data;
          const dStatus = (data.status || '').toString();
          const dCat = (data.statusCategory || '').toString();
          if (
            dStatus === 'completed' ||
            dStatus === 'cancelled' ||
            dStatus === 'finished' ||
            dStatus === 'paid' ||
            dCat.includes('已完成') ||
            dCat.includes('已取消') ||
            dCat.includes('已支付') ||
            dCat.includes('已结单')
          ) {
            return true;
          }
        }
      }
    } catch (_) {}
  }

  return false;
}

