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
      if (Array.isArray(savedMerchant)) {
        let match: any = null;
        if (orderId) {
          // Strictly match by order ID only! Never match different orders by passenger phone or address
          match = savedMerchant.find((o: any) =>
            o && (o.id === orderId || o.orderId === orderId || o.orderNo === orderId || o.orderNumber === orderId)
          );
        } else if (pPhone && startLoc && !isPlaceholderPhone(pPhone)) {
          // Fallback only when orderId is completely absent and phone is a real non-placeholder phone
          const orderTime = Number(order.timestamp || order.createdAt || 0);
          match = savedMerchant.find((o: any) => {
            if (!o) return false;
            const oPhone = (o.passengerPhone || o.phone || '').toString().trim();
            const oLoc = (o.startLocation || o.pickupName || '').toString().trim();
            const oTime = Number(o.timestamp || o.createdAt || 0);
            const timeDiff = Math.abs(orderTime - oTime);
            return oPhone === pPhone && oLoc === startLoc && (timeDiff < 30 * 60 * 1000);
          });
        }

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

      for (const key of storageKeys) {
        const historyRaw = localStorage.getItem(key);
        if (historyRaw) {
          const history = JSON.parse(historyRaw);
          if (Array.isArray(history)) {
            let matchHist: any = null;
            if (orderId) {
              // Strictly match by order ID only! Never match different orders by passenger phone or address
              matchHist = history.find((h: any) =>
                h && (h.id === orderId || h.orderId === orderId || h.orderNumber === orderId || h.orderNo === orderId)
              );
            } else if (pPhone && startLoc && !isPlaceholderPhone(pPhone)) {
              const orderTime = Number(order.timestamp || order.createdAt || 0);
              matchHist = history.find((h: any) => {
                if (!h) return false;
                const hPhone = (h.passengerPhone || h.phone || '').toString().trim();
                const hLoc = (h.startLocation || h.endLocation || '').toString().trim();
                const hTime = Number(h.timestamp || h.createdAt || 0);
                const timeDiff = Math.abs(orderTime - hTime);
                return hPhone === pPhone && hLoc === startLoc && (timeDiff < 30 * 60 * 1000);
              });
            }

            if (matchHist) {
              return true;
            }
          }
        }
      }
    } catch (_) {}
  }

  // 4. Remote API check to Baota / MySQL DB
  if (orderId) {
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

