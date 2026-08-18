import { db, doc, getDoc, setDoc } from '../lib/dbProxy';

/**
 * Unique Device Identifier per installation
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server_side';
  let deviceId = localStorage.getItem('dd_device_id');
  if (!deviceId) {
    deviceId = 'DEV_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
    localStorage.setItem('dd_device_id', deviceId);
  }
  return deviceId;
}

/**
 * Check single device login via Aliyun Baota Express Server API.
 * Successful SMS code verification proves physical SIM ownership.
 * SMS login automatically takes over the active device session and registers the new device.
 */
export async function checkSingleDeviceLogin(phone: string): Promise<{ allowed: boolean; message?: string }> {
  // SMS verification always takes precedence, allowing new install/reinstall login and updating active device
  return { allowed: true };
}

/**
 * Register active session for this phone and device on Aliyun Baota Server API
 */
export async function registerDeviceSession(phone: string): Promise<void> {
  try {
    const currentDeviceId = getDeviceId();
    const sessionRef = doc(db, 'user_sessions', phone);
    await setDoc(sessionRef, {
      phone,
      deviceId: currentDeviceId,
      active: true,
      lastLoginTime: Date.now(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.error('[DeviceSession] Register device session error:', err);
  }
}

/**
 * Deactivate session on logout via Aliyun Baota Server API
 */
export async function clearDeviceSession(phone: string): Promise<void> {
  try {
    const currentDeviceId = getDeviceId();
    const sessionRef = doc(db, 'user_sessions', phone);
    const snap = await getDoc(sessionRef);
    if (snap && snap.exists()) {
      const data = snap.data();
      if (!data.deviceId || data.deviceId === currentDeviceId) {
        await setDoc(sessionRef, {
          active: false,
          logoutTime: Date.now(),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    }
  } catch (err) {
    console.error('[DeviceSession] Clear device session error:', err);
  }
}

/**
 * Verify active device session during app runtime.
 * If another device logs in with SMS code, this detects deviceId change and triggers force logout on the older session.
 */
export async function verifyActiveDeviceSession(phone: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    if (!phone) return { valid: true };
    const currentDeviceId = getDeviceId();
    const sessionRef = doc(db, 'user_sessions', phone);
    const snap = await getDoc(sessionRef);

    if (snap && snap.exists()) {
      const data = snap.data();
      if (data && data.active === true && data.deviceId && data.deviceId !== currentDeviceId) {
        return {
          valid: false,
          reason: `⚠️ 您的账号 (${phone}) 已在其他设备上登录，当前设备已自动安全下线。`
        };
      }
    }
    return { valid: true };
  } catch (err) {
    console.warn('[DeviceSession] Verify active device session check failed:', err);
    return { valid: true };
  }
}
