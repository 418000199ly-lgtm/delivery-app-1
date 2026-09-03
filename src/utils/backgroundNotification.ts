import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { speakText } from './speech';

const PENDING_ORDER_STORAGE_KEY = 'dd_pending_incoming_order';

/**
 * Initialize native notification channels (Android High-Priority / Full-Screen Popup)
 * and request notification permissions & geolocation permissions from the operating system.
 */
export async function initNotificationSystem(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (Capacitor.isNativePlatform()) {
    try {
      // 1. Request OS Geolocation Permissions so iOS/Android triggers native location dialog
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          () => {},
          (err) => console.warn('[Notif] Geolocation initial prompt result:', err.message),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        );
      }

      // 2. Create Android High Priority Notification Channel
      await LocalNotifications.createChannel({
        id: 'incoming_orders',
        name: '代驾新来单高强提醒',
        description: '当手机锁屏或切换后台时，新来单强弹与高音鸣响提醒',
        importance: 5, // MAX Importance (Heads-up popup banner)
        visibility: 1, // Public on lockscreen
        sound: undefined, // System default high alarm
        vibration: true,
        lights: true,
        lightColor: '#FF0000',
      }).catch((e) => console.warn('[Notif] createChannel warn:', e));

      // 3. Request OS Notification Permissions
      const status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        return req.display === 'granted';
      }
      return true;
    } catch (err) {
      console.warn('[Notif] Native init error:', err);
      return false;
    }
  } else if ('Notification' in window) {
    try {
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        return perm === 'granted';
      }
      return Notification.permission === 'granted';
    } catch (e) {
      return false;
    }
  }

  return false;
}

/**
 * Cache pending incoming order in localStorage so that when the app opens or resumes,
 * the IncomingOrderOverlay is immediately shown.
 */
export function setPendingOrderCache(order: any) {
  if (!order) {
    try { localStorage.removeItem(PENDING_ORDER_STORAGE_KEY); } catch (_) {}
    return;
  }
  try {
    localStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify({
      order,
      timestamp: Date.now()
    }));
  } catch (_) {}
}

/**
 * Retrieve cached pending order if valid (created within last 5 minutes)
 */
export function getPendingOrderCache(): any | null {
  try {
    const raw = localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.order && parsed.timestamp) {
      // 5 min expiration
      if (Date.now() - parsed.timestamp < 300000) {
        return parsed.order;
      }
    }
    localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
  } catch (_) {}
  return null;
}

/**
 * Clear cached pending order
 */
export function clearPendingOrderCache() {
  try {
    localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
  } catch (_) {}
  if (Capacitor.isNativePlatform()) {
    try {
      LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
    } catch (_) {}
  }
}

/**
 * Trigger high-priority system alert (Sound, Voice, Vibration, System Banner, Lockscreen Popup)
 * when a new order arrives while the app is in the background or locked.
 */
export async function triggerBackgroundOrderAlert(order: any) {
  if (!order) return;

  // Cache order so app foreground reload instantly opens overlay
  setPendingOrderCache(order);

  const startLoc = order.startLocation || '起点位置';
  const destLoc = order.destination || '终点位置';
  const isValet = Boolean(
    order.isValetOrder ||
    order.isPlatformDispatch ||
    order.orderRemark === '商户代叫' ||
    order.orderType === '商户代叫' ||
    order.orderType === '后台指派订单'
  );

  const notifTitle = isValet ? '🚖 收到新的代叫/派单！' : '⚡ 收到新来单，请确认接单！';
  const notifBody = `从 [${startLoc}] 到 [${destLoc}]。手机后台已为您抢先锁定，请点击立即接单！`;

  // 1. Loud Voice TTS Alert ("注意，收到新代驾分配订单，起点：...")
  const speechText = `注意！收到新的代驾派单，起点：${startLoc}，请及时查看并确认接单！`;
  speakText(speechText);

  // 2. High-intensity vibration
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([1000, 300, 1000, 300, 1000, 300, 1000]);
    } catch (_) {}
  }

  // 3. Send Native Local Notification (Android / iOS)
  if (Capacitor.isNativePlatform()) {
    try {
      const notifId = Math.floor(Math.random() * 899999) + 100000;
      await LocalNotifications.schedule({
        notifications: [
          {
            title: notifTitle,
            body: notifBody,
            id: notifId,
            channelId: 'incoming_orders',
            schedule: { at: new Date(Date.now() + 100) },
            sound: undefined,
            actionTypeId: 'OPEN_INCOMING_ORDER',
            extra: {
              orderData: order,
              orderId: order.id || order.orderId || `${Date.now()}`
            }
          }
        ]
      });
    } catch (err) {
      console.warn('[Notif] Native schedule error:', err);
    }
  } else if (typeof window !== 'undefined' && 'Notification' in window) {
    // Web / PWA Notification
    try {
      if (Notification.permission === 'granted') {
        const notif = new Notification(notifTitle, {
          body: notifBody,
          icon: '/hwdjtb.png',
          tag: 'incoming_order_' + (order.id || order.orderId || Date.now()),
          requireInteraction: true
        });
        notif.onclick = () => {
          try { window.focus(); } catch (_) {}
          notif.close();
        };
      }
    } catch (_) {}
  }
}

/**
 * Register global app listeners for Capacitor App resume & Notification clicks
 */
export function registerBackgroundOrderListeners(onOrderTriggered: (order: any) => void) {
  if (typeof window === 'undefined') return () => {};

  const cleanups: (() => void)[] = [];

  // Listener 1: Native LocalNotification Action Performed (when user taps notification banner)
  if (Capacitor.isNativePlatform()) {
    try {
      const handle = LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const extra = action.notification?.extra;
        if (extra && extra.orderData) {
          onOrderTriggered(extra.orderData);
        } else {
          const cached = getPendingOrderCache();
          if (cached) onOrderTriggered(cached);
        }
      });
      cleanups.push(() => {
        handle.then(h => h.remove()).catch(() => {});
      });
    } catch (_) {}
  }

  // Listener 2: Capacitor App State Change (when app returns from background to foreground)
  if (Capacitor.isNativePlatform()) {
    try {
      const handle = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          const cached = getPendingOrderCache();
          if (cached) {
            onOrderTriggered(cached);
          }
        }
      });
      cleanups.push(() => {
        handle.then(h => h.remove()).catch(() => {});
      });
    } catch (_) {}
  }

  // Listener 3: Web visibilitychange (when browser tab or PWA comes to foreground)
  const handleVisibility = () => {
    if (!document.hidden) {
      const cached = getPendingOrderCache();
      if (cached) {
        onOrderTriggered(cached);
      }
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  cleanups.push(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
  });

  return () => {
    cleanups.forEach(fn => fn());
  };
}
