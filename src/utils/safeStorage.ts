/**
 * Safe LocalStorage Wrapper with Auto-Cleanup on Quota Exceeded.
 * Protects the app from QuotaExceededError crashes when storing large data.
 */

export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    console.warn(`[safeSetItem] Storage quota exceeded or error when setting key "${key}":`, err);

    // Attempt automatic cleanup of non-essential bulky cached items
    try {
      pruneLocalStorage();
      // Retry setting item after pruning
      localStorage.setItem(key, value);
      console.log(`[safeSetItem] Successfully saved key "${key}" after storage cleanup.`);
      return true;
    } catch (retryErr) {
      console.error(`[safeSetItem] Secondary failure setting key "${key}". Attempting trimmed save.`, retryErr);
      
      // If it's a JSON array or trip object, attempt to trim base64 or heavy arrays
      try {
        if (key === 'dd_current_trip') {
          const trip = JSON.parse(value);
          // Strip heavy base64 QR images before saving trip state to storage
          if (trip.paymentQrCode && trip.paymentQrCode.length > 500) {
            delete trip.paymentQrCode;
          }
          if (trip.merchantPaymentQrCode && trip.merchantPaymentQrCode.length > 500) {
            delete trip.merchantPaymentQrCode;
          }
          localStorage.setItem(key, JSON.stringify(trip));
          return true;
        } else if (key === 'dd_merchant_orders_v2') {
          const orders = JSON.parse(value);
          if (Array.isArray(orders)) {
            // Keep only latest 10 orders
            localStorage.setItem(key, JSON.stringify(orders.slice(0, 10)));
            return true;
          }
        }
      } catch (_) {}
      
      return false;
    }
  }
}

export function safeGetItem(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn(`[safeGetItem] Error reading key "${key}":`, err);
    return null;
  }
}

export function safeRemoveItem(key: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[safeRemoveItem] Error removing key "${key}":`, err);
  }
}

/**
 * Prunes large non-essential cached keys from localStorage when quota is hit.
 */
export function pruneLocalStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const keysToRemove: string[] = [];
  const keysToTrim: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;

    // 1. Remove mock db entries, cached QR codes, location logs
    if (
      k.startsWith('mock_db_') ||
      k.startsWith('dd_dispatch_wechat_qr_') ||
      k.startsWith('dd_driver_loc_') ||
      k.includes('temp') ||
      k.includes('cache')
    ) {
      keysToRemove.push(k);
    }

    // 2. Identify heavy JSON lists to trim
    if (k === 'dd_merchant_orders_v2' || k === 'dd_rules_list' || k === 'dd_squad_members_v2') {
      keysToTrim.push(k);
    }
  }

  // Remove low priority keys
  for (const k of keysToRemove) {
    try { localStorage.removeItem(k); } catch (_) {}
  }

  // Trim heavy arrays
  for (const k of keysToTrim) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 15) {
          localStorage.setItem(k, JSON.stringify(parsed.slice(0, 15)));
        }
      }
    } catch (_) {}
  }
}
