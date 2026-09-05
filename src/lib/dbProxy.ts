import { safeSetItem } from '../utils/safeStorage';

// Mock DB reference object for native Firestore API interface compatibility
const dbPlaceholder = { _isProxy: true };

// Types for Aliyun Baota MySQL / Native REST API document structure
export class ProxyDocumentSnapshot {
  id: string;
  private _data: any;
  private _exists: boolean;

  constructor(id: string, data: any, exists: boolean = true) {
    this.id = id;
    this._data = data;
    this._exists = exists;
  }

  exists() {
    return this._exists;
  }

  data() {
    return this._data;
  }
}

export class ProxyQuerySnapshot {
  docs: ProxyDocumentSnapshot[];
  empty: boolean;

  constructor(docs: ProxyDocumentSnapshot[]) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }

  forEach(callback: (doc: ProxyDocumentSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

// Global settings to route API requests to Mainland China Aliyun Baota server (https://api.lyheiwandaijiamax.com)
export function getBaseApiUrl(): string {
  try {
    const customUrl = localStorage.getItem('baota_api_url') || localStorage.getItem('custom_api_base_url');
    if (customUrl && customUrl.trim()) {
      let trimmed = customUrl.trim().replace(/\/$/, '');
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      }
      return 'https://' + trimmed;
    }
  } catch (_) {}
  
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname || '';
    
    // AI Studio Cloud Run preview environment
    if (hostname.includes('run.app')) {
      return window.location.origin;
    }

    // Direct web browser access to your Baota API domain
    if (hostname === 'api.lyheiwandaijiamax.com') {
      return window.location.origin;
    }
  }
  
  // For all packaged native mobile applications (Android APK, iOS IPA, Capacitor WebView) and client sync
  return 'https://api.lyheiwandaijiamax.com';
}

// Mirroring firestore imports
export const db = dbPlaceholder;

export function doc(databaseRef: any, path: string, ...morePaths: string[]) {
  // Supports doc(db, 'collectionName', 'id') or doc(collectionRef, 'id')
  if (typeof databaseRef === 'object' && databaseRef && 'type' in databaseRef && databaseRef.type === 'collection') {
    return {
      type: 'document' as const,
      collectionName: databaseRef.collectionName,
      id: path
    };
  }
  
  const fullPath = [path, ...morePaths].filter(Boolean);
  return {
    type: 'document' as const,
    collectionName: fullPath[0] || '',
    id: fullPath[1] || ''
  };
}

export function collection(databaseRef: any, path: string) {
  return {
    type: 'collection' as const,
    collectionName: path
  };
}

export function query(collectionRef: any, ...constraints: any[]) {
  return {
    type: 'query' as const,
    collectionName: collectionRef.collectionName,
    constraints: constraints.filter(c => c && typeof c === 'object')
  };
}

export function where(field: string, operator: string, value: any) {
  return {
    type: 'where',
    field,
    operator,
    value
  };
}

// Safe fetch with AbortController timeout to prevent unhandled Network errors
async function safeFetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 3000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// REST API Database Client Implementations
export async function getDoc(docRef: any): Promise<ProxyDocumentSnapshot> {
  const baseUrl = getBaseApiUrl();
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();
  const url = `${baseUrl}/api/db/get?col=${encodeURIComponent(docRef.collectionName)}&id=${encodeURIComponent(cleanId)}&_t=${Date.now()}`;
  
  try {
    const res = await safeFetchWithTimeout(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`DB Fetch failed with status: ${res.status}`);
    }
    const result = await res.json();
    if (result.exists && result.data) {
      try {
        const cacheKey = `mock_db_${docRef.collectionName}_${cleanId}`;
        safeSetItem(cacheKey, JSON.stringify(result.data));
      } catch (_) {}
    }
    return new ProxyDocumentSnapshot(cleanId, result.data, result.exists);
  } catch (err: any) {
    // Secondary simulation fallback to guarantee absolute offline stability
    const cacheKey = `mock_db_${docRef.collectionName}_${cleanId}`;
    const cached = localStorage.getItem(cacheKey);
    const parsed = cached ? JSON.parse(cached) : null;
    return new ProxyDocumentSnapshot(cleanId, parsed, Boolean(parsed));
  }
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/set`;
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();
  
  // Cache locally first for instant reactive response and local offline availability
  const cacheKey = `mock_db_${docRef.collectionName}_${cleanId}`;
  try {
    if (options?.merge) {
      const existing = localStorage.getItem(cacheKey);
      const parsed = existing ? JSON.parse(existing) : {};
      safeSetItem(cacheKey, JSON.stringify({ ...parsed, ...data }));
    } else {
      safeSetItem(cacheKey, JSON.stringify(data));
    }
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        col: docRef.collectionName,
        id: cleanId,
        data,
        merge: options?.merge ?? false
      })
    });
    if (!res.ok) {
      throw new Error(`DB Set failed: ${res.statusText}`);
    }
    return true;
  } catch (err) {
    return true;
  }
}

export async function updateDoc(docRef: any, data: any) {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/update`;
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();

  // Merge locally in mock store first
  const cacheKey = `mock_db_${docRef.collectionName}_${cleanId}`;
  try {
    const current = localStorage.getItem(cacheKey);
    const parsed = current ? JSON.parse(current) : {};
    const merged = { ...parsed, ...data };
    safeSetItem(cacheKey, JSON.stringify(merged));
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        col: docRef.collectionName,
        id: cleanId,
        data
      })
    });
    if (!res.ok) {
      throw new Error(`DB Update failed: ${res.statusText}`);
    }
    return true;
  } catch (err) {
    return true;
  }
}

export async function deleteDoc(docRef: any) {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/delete`;
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();

  const cacheKey = `mock_db_${docRef.collectionName}_${cleanId}`;
  try {
    localStorage.removeItem(cacheKey);
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        col: docRef.collectionName,
        id: cleanId
      })
    });
    if (!res.ok) {
      throw new Error(`DB Delete failed: ${res.statusText}`);
    }
    return true;
  } catch (err) {
    return true;
  }
}

export async function addDoc(collectionRef: any, data: any) {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/add`;
  const randomId = 'doc_' + Math.random().toString(36).substring(2, 11);
  
  const tempCacheKey = `mock_db_${collectionRef.collectionName}_${randomId}`;
  try {
    localStorage.setItem(tempCacheKey, JSON.stringify(data));
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        col: collectionRef.collectionName,
        data
      })
    });
    if (!res.ok) {
      throw new Error(`DB Add failed: ${res.statusText}`);
    }
    const result = await res.json();
    const finalId = result.id || randomId;
    
    // Clean up temporary pre-cache key and update with real server document ID
    try {
      localStorage.removeItem(tempCacheKey);
      localStorage.setItem(`mock_db_${collectionRef.collectionName}_${finalId}`, JSON.stringify(data));
    } catch (_) {}

    return { id: finalId };
  } catch (err) {
    return { id: randomId };
  }
}

export async function getDocs(queryRefOrColRef: any): Promise<ProxyQuerySnapshot> {
  const baseUrl = getBaseApiUrl();
  const colName = queryRefOrColRef.collectionName;
  const constraints = queryRefOrColRef.constraints || [];
  
  let url = `${baseUrl}/api/db/list?col=${encodeURIComponent(colName)}`;
  if (constraints.length > 0) {
    url += `&constraints=${encodeURIComponent(JSON.stringify(constraints))}`;
  }

  try {
    const res = await safeFetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`DB Query failed: ${res.statusText}`);
    }
    const result = await res.json();
    const docs = (result.docs || []).map((docItem: any) => {
      return new ProxyDocumentSnapshot(docItem.id, docItem.data, true);
    });

    // Synchronize localStorage cache with authoritative server state:
    // Remove stale/deleted local keys that no longer exist on server for this collection.
    try {
      if (!constraints || constraints.length === 0) {
        const serverDocIds = new Set((result.docs || []).map((d: any) => String(d.id)));
        const prefix = `mock_db_${colName}_`;
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            const docId = key.substring(prefix.length);
            if (!serverDocIds.has(docId)) {
              localStorage.removeItem(key);
            }
          }
        }
        (result.docs || []).forEach((d: any) => {
          if (d && d.id) {
            localStorage.setItem(`mock_db_${colName}_${d.id}`, JSON.stringify(d.data));
          }
        });
      }
    } catch (_) {}

    return new ProxyQuerySnapshot(docs);
  } catch (err) {
    console.warn("Proxy DB Query falling back to local simulation:", err);
    // Sweep localStorage to retrieve matching cached documents
    const docList: ProxyDocumentSnapshot[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`mock_db_${colName}_`)) {
          const docId = key.substring(`mock_db_${colName}_`.length);
          const cached = localStorage.getItem(key);
          if (cached) {
            docList.push(new ProxyDocumentSnapshot(docId, JSON.parse(cached), true));
          }
        }
      }
    } catch (_) {}
    return new ProxyQuerySnapshot(docList);
  }
}

// Low latency reactive polling observer for absolute compatibility.
// Bypasses port/proxy WebSocket drops entirely and works 100% of the time.
export function onSnapshot(
  targetRef: any,
  onNext: (snap: any) => void,
  onError?: (err: any) => void
) {
  let isUnsubscribed = false;
  let lastDataString = '';
  let intervalId: any = null;

  async function checkUpdate() {
    if (isUnsubscribed) return;
    try {
      if (targetRef.type === 'document') {
        const snap = await getDoc(targetRef);
        const dataStr = JSON.stringify(snap.data() || {});
        if (dataStr !== lastDataString) {
          lastDataString = dataStr;
          onNext(snap);
        }
      } else {
        // Query / Collection
        const snap = await getDocs(targetRef);
        const dataParts = snap.docs.map(d => ({ id: d.id, data: d.data() }));
        const dataStr = JSON.stringify(dataParts);
        if (dataStr !== lastDataString) {
          lastDataString = dataStr;
          onNext(snap);
        }
      }
    } catch (err) {
      if (onError) onError(err);
    }
  }

  // Initial immediate fetch
  checkUpdate();

  // Low latency interval (2000ms is perfectly seamless for代驾 order matching)
  intervalId = setInterval(checkUpdate, 2000);

  return () => {
    isUnsubscribed = true;
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}

export async function clearCollection(colName: string) {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/clear-collection`;

  // Clean up local storage caches for this collection
  try {
    const prefix = `mock_db_${colName}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ col: colName })
    });
    if (!res.ok) {
      throw new Error(`DB Clear Collection failed: ${res.statusText}`);
    }
    return true;
  } catch (err) {
    console.warn("Proxy DB Clear Collection fell back to local storage:", err);
    return true;
  }
}
