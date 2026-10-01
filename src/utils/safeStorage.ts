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

    // 1. Attempt automatic cleanup of non-essential bulky cached items
    try {
      pruneLocalStorage();
      // Retry setting item after pruning
      localStorage.setItem(key, value);
      console.log(`[safeSetItem] Successfully saved key "${key}" after storage cleanup.`);
      return true;
    } catch (retryErr) {
      console.error(`[safeSetItem] Secondary failure setting key "${key}". Attempting trimmed save.`, retryErr);

      // 2. If setting still fails, attempt payload-specific trimming (base64 image stripping)
      try {
        let trimmedValue = value;

        // If key is settings, strip heavy base64 images from settings object
        if (key.startsWith('dd_settings')) {
          try {
            const parsed = JSON.parse(value);
            if (parsed.wechatQrCode && parsed.wechatQrCode.length > 1000 && parsed.wechatQrCode.startsWith('data:')) {
              delete parsed.wechatQrCode;
            }
            if (parsed.alipayQrCode && parsed.alipayQrCode.length > 1000 && parsed.alipayQrCode.startsWith('data:')) {
              delete parsed.alipayQrCode;
            }
            trimmedValue = JSON.stringify(parsed);
          } catch (_) {}
        } else if (key === 'dd_current_trip') {
          try {
            const trip = JSON.parse(value);
            if (trip.paymentQrCode && trip.paymentQrCode.length > 500) {
              delete trip.paymentQrCode;
            }
            if (trip.merchantPaymentQrCode && trip.merchantPaymentQrCode.length > 500) {
              delete trip.merchantPaymentQrCode;
            }
            trimmedValue = JSON.stringify(trip);
          } catch (_) {}
        } else if (key === 'dd_merchant_orders_v2' || key.startsWith('dd_declined_orders_')) {
          try {
            const orders = JSON.parse(value);
            if (Array.isArray(orders)) {
              trimmedValue = JSON.stringify(orders.slice(-5));
            }
          } catch (_) {}
        }

        // Retry saving trimmed value
        localStorage.setItem(key, trimmedValue);
        return true;
      } catch (finalErr) {
        console.error(`[safeSetItem] Critical: Unable to save key "${key}" even after trimming:`, finalErr);
        // Safely fail without throwing to prevent React AppErrorBoundary crash
        return false;
      }
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
      k.startsWith('dd_dispatch_alipay_qr_') ||
      k.startsWith('dd_driver_loc_') ||
      k.startsWith('dd_declined_orders_') ||
      k.includes('temp') ||
      k.includes('cache')
    ) {
      keysToRemove.push(k);
    }

    // 2. Identify heavy JSON lists / settings to trim
    if (k === 'dd_merchant_orders_v2' || k === 'dd_rules_list' || k === 'dd_squad_members_v2' || k.startsWith('dd_settings')) {
      keysToTrim.push(k);
    }
  }

  // Remove low priority keys
  for (const k of keysToRemove) {
    try { localStorage.removeItem(k); } catch (_) {}
  }

  // Trim heavy arrays / settings
  for (const k of keysToTrim) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        if (k.startsWith('dd_settings')) {
          try {
            const parsed = JSON.parse(raw);
            let modified = false;
            if (parsed.wechatQrCode && parsed.wechatQrCode.length > 1000 && parsed.wechatQrCode.startsWith('data:')) {
              delete parsed.wechatQrCode;
              modified = true;
            }
            if (parsed.alipayQrCode && parsed.alipayQrCode.length > 1000 && parsed.alipayQrCode.startsWith('data:')) {
              delete parsed.alipayQrCode;
              modified = true;
            }
            if (modified) {
              localStorage.setItem(k, JSON.stringify(parsed));
            }
          } catch (_) {}
        } else {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 10) {
            localStorage.setItem(k, JSON.stringify(parsed.slice(-10)));
          }
        }
      }
    } catch (_) {}
  }
}
