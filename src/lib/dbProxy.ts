import { safeSetItem } from '../utils/safeStorage';
import { DEVELOPER_PHONE } from '../utils/constants';
import { scheduleResumeTask } from '../utils/resumeCoordinator';

// 缓存版本：每次发版递增，自动隔离旧缓存，防止预览显示过期数据
// 中国大陆项目：数据直连阿里云，禁用被墙服务
const DB_CACHE_VERSION = 'v20261011a';

// DB reference object for Mainland China Aliyun Baota MySQL REST API interface compatibility
const dbPlaceholder = { _isProxy: true };

// 启动时清理旧版本缓存，防止显示过期数据（一次性）
try {
  const lastVer = localStorage.getItem('db_cache_version');
  if (lastVer !== DB_CACHE_VERSION) {
    Object.keys(localStorage).filter(k => k.startsWith('mock_db_')).forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    // 清理 AdminPanel 的聚合缓存
    ['cached_unified_drivers', 'dd_squad_members_v2', 'dd_applicants_v2', 'dd_removed_squad_phones_v2'].forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    localStorage.setItem('db_cache_version', DB_CACHE_VERSION);
  }
} catch (_) {}

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

// Global settings to route API requests to Mainland China Aliyun Baota server

/** 获取认证请求头：短信登录后服务端签发的 token，用于 /api/db/* 写操作鉴权 */
export function getAuthHeaders(): Record<string, string> {
  // 2026-10-19: 所有请求带 X-App-Version 头，供服务端 V1.0 拦截识别
  // V2.0 App 与管理后台（同一套构建）自动带版本，V1.0 老构建没这行会被拦
  const headers: Record<string, string> = { 'X-App-Version': 'V2.0' };
  try {
    const token = localStorage.getItem('dd_auth_token');
    if (token) {
      headers['X-Auth-Token'] = token;
    }
  } catch (_) {}
  return headers;
}

/**
 * M8修复：区分鉴权失败与网络错误
 * 401 → 清除本地token并抛出错误（调用方需处理重登录）
 * 403 → 只抛错显示原因，不清 token、不跳登录（P1-1修复 2026-10-19）
 * 网络错误 → 返回true保持乐观（本地已写）
 */
function isAuthError(err: any): boolean {
  const msg = String(err?.message || '');
  const status = (err as any)?.status;
  return status === 401 || msg.includes('401');
}

function isForbiddenError(err: any): boolean {
  const msg = String(err?.message || '');
  const status = (err as any)?.status;
  return status === 403 || msg.includes('403');
}

function clearAuthTokenOn401(): void {
  try {
    localStorage.removeItem('dd_auth_token');
    window.dispatchEvent(new CustomEvent('auth_token_expired'));
  } catch (_) {}
}

export function getBaseApiUrl(): string {
  try {
    const customUrl = localStorage.getItem('baota_api_url') || localStorage.getItem('custom_api_base_url');
    if (customUrl && customUrl.trim()) {
      let trimmed = customUrl.trim().replace(/\/$/, '');
      const urlStr = (trimmed.startsWith('http://') || trimmed.startsWith('https://')) ? trimmed : 'https://' + trimmed;
      // 2026-10-22 第十轮加固：自定义 API 地址是 Cloudflare 时期遗留。生产唯一合法端点是
      // api.lyheiwandaijiamax.com（本地开发放行 localhost）。浏览器里一旦残留旧地址
      // （旧服务器/Worker 地址），全部数据请求会被带偏，表现与「登录失效/数据库连接受阻」
      // 完全一致且重登无法自愈。故非白名单覆盖值一律忽略并清除，回落默认端点。
      let host = '';
      try { host = new URL(urlStr).hostname; } catch (_) {}
      if (host === 'api.lyheiwandaijiamax.com' || host === 'localhost' || host === '127.0.0.1') {
        return urlStr;
      }
      try {
        localStorage.removeItem('baota_api_url');
        localStorage.removeItem('custom_api_base_url');
        localStorage.removeItem('cloudflare_worker_api_url');
      } catch (_) {}
    }
  } catch (_) {}
  
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname || '';
    const protocol = window.location.protocol || '';
    
    // Check if running inside a native mobile app (Capacitor WebView has localhost hostname but with capacitor:// or app:// protocol, or runs inside file://)
    const isNativeMobileApp = 
      protocol.startsWith('capacitor') || 
      protocol.startsWith('app') || 
      protocol.startsWith('file') || 
      (typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) ||
      (typeof (window as any).webkit !== 'undefined' && !(window as any).webkit?.messageHandlers?.length);

    if (isNativeMobileApp) {
      // Packaged mobile apps on Android/iOS connect directly to the primary Baota API endpoint
      return 'https://api.lyheiwandaijiamax.com';
    }

    // In web browsers:
    // If on admin.lyheiwandaijiamax.com or lyheiwandaijiamax.com, data communicates through https://api.lyheiwandaijiamax.com
    if (hostname.includes('lyheiwandaijiamax.com')) {
      return 'https://api.lyheiwandaijiamax.com';
    }

    // For external static previews (e.g. GitHub Pages) with no Baota proxy,
    // MUST use the direct Aliyun API endpoint, otherwise /api/db/* 404s and
    // the app falls back to stale localStorage cache (data never syncs).
    // 中国大陆项目：所有数据直连阿里云，禁用任何被墙服务。
    if (hostname.includes('github.io') || hostname.includes('netlify.app') || hostname.includes('vercel.app')) {
      return 'https://api.lyheiwandaijiamax.com';
    }

    // For local preview environments with a Baota proxy (e.g. localhost), use same-origin
    if (window.location.origin && !window.location.origin.includes('null')) {
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
      if (isLocal) {
        return window.location.origin;
      }
      // Unknown external host: default to direct Aliyun API (never a dead static origin)
      return 'https://api.lyheiwandaijiamax.com';
    }
  }
  
  // Direct production API endpoint of the Baota Server
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
async function safeFetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 12000): Promise<Response> {
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
// 2026-10-24 第四十二轮：读请求去重。生产访问日志实证：多个组件在同一毫秒并发拉取
// 同一文档（同 _t 的 driver_users GET 一秒内出现 3 次）、集合订阅各自全量拉表，
// 单台手机即打出每秒数十个请求，把服务端单核打满（node 64% CPU）。
// 机制：同一 key 的读在 2 秒窗口内共享同一次网络请求（在途合并 + 短时复用）；
// 写操作（set/update/delete）按集合失效相关读缓存，保证写后读不读到旧值。
// 专用接口（claim/complete/dispatch 等）不经此层，不受影响。
const _readCache = new Map<string, { at: number; promise: Promise<any> }>();
const READ_DEDUPE_TTL_MS = 2000;
function dedupedRead<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = _readCache.get(key);
  if (hit && (now - hit.at) < READ_DEDUPE_TTL_MS) return hit.promise as Promise<T>;
  const promise = fn();
  _readCache.set(key, { at: now, promise });
  promise.catch(() => {
    const cur = _readCache.get(key);
    if (cur && cur.promise === promise) _readCache.delete(key);
  });
  return promise;
}
function invalidateReadCache(colName: string, docId?: string) {
  if (docId) _readCache.delete(`doc:${colName}:${docId}`);
  for (const k of Array.from(_readCache.keys())) {
    if (k.startsWith(`list:${colName}:`)) _readCache.delete(k);
  }
  // 第四十二轮续修5：本端写过的集合清增量状态，下一轮列表必走全量（防合并图过期）
  for (const k of Array.from(_listIncr.keys())) {
    if (k.startsWith(`${colName}|`)) _listIncr.delete(k);
  }
}

export function getDoc(docRef: any): Promise<ProxyDocumentSnapshot> {
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();
  return dedupedRead(`doc:${docRef.collectionName}:${cleanId}`, () => getDocUncached(docRef));
}

async function getDocUncached(docRef: any): Promise<ProxyDocumentSnapshot> {
  const baseUrl = getBaseApiUrl();
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();
  const url = `${baseUrl}/api/db/get?col=${encodeURIComponent(docRef.collectionName)}&id=${encodeURIComponent(cleanId)}&_t=${Date.now()}`;
  
  try {
    const res = await safeFetchWithTimeout(url, { cache: 'no-store', headers: { ...getAuthHeaders() } });
    if (!res.ok) {
      const qErr: any = new Error(`DB Fetch failed with status: ${res.status}`);
      qErr.status = res.status;
      throw qErr;
    }
    const result = await res.json();
    try {
      const cacheKey = `mock_db_${DB_CACHE_VERSION}_${docRef.collectionName}_${cleanId}`;
      if (result.exists && result.data) {
        safeSetItem(cacheKey, JSON.stringify({ ...result.data, _cachedAt: Date.now() }));
      } else {
        // 2026-10-23 视角深挖修复：服务端明确「不存在」时清掉本地缓存，
        // 让删除/驳回/移出在第一次成功轮询即永久生效，杜绝旧缓存复活。
        localStorage.removeItem(cacheKey);
      }
    } catch (_) {}
    return new ProxyDocumentSnapshot(cleanId, result.data, result.exists);
  } catch (err: any) {
    // 2026-10-17根治：401/403 是鉴权失败，不是"无数据"，必须清 token 并抛出，
    // 绝不能回退旧缓存伪装成"不存在"（否则调用方会误判小队成员/订单不存在）。
    if (isAuthError(err)) {
      clearAuthTokenOn401();
      throw err;
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    // 2026-10-23 视角深挖修复（闪烁总根源）：旧实现对 squad_members 等司机集合在
    // 网络失败时直接返回「文档不存在」，一次弱网抖动（隧道/地库/电梯/服务器重启）
    // 就让成员状态翻假：大厅、接单授权徽章、报单转单按钮随 5 秒轮询成败横跳，
    // 2026-10-16「已到期→几秒后恢复2天」、10-20「授权(0)一会显示一会不显示」皆源于此。
    // 改为与其它集合一致的新鲜缓存兜底：10 分钟内的缓存（每次成功轮询都会刷新时间戳）
    // 视为最后已知事实；服务端明确不存在时已清缓存（见成功路径），删除不会被复活；
    // 一切接单动作仍由服务端二次验权，显示层短暂沿用旧值无安全后果。
    const cacheKey = `mock_db_${DB_CACHE_VERSION}_${docRef.collectionName}_${cleanId}`;
    let parsed: any = null;
    try {
      const cached = localStorage.getItem(cacheKey);
      parsed = cached ? JSON.parse(cached) : null;
    } catch (_) { parsed = null; }
    if (parsed) {
      const stamp = Number(parsed._cachedAt || parsed._lastLocalWriteTime || 0);
      if (!stamp || (Date.now() - stamp) < 10 * 60 * 1000) {
        return new ProxyDocumentSnapshot(cleanId, parsed, true);
      }
    }
    return new ProxyDocumentSnapshot(cleanId, null, false);
  }
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  invalidateReadCache(docRef.collectionName, String(docRef.id || '').replace(/\s+/g, '').trim());
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/set`;
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();
  const isMerge = options?.merge !== false; // Default to merge: true
  
  // Cache locally first for instant reactive response and local offline availability
  const cacheKey = `mock_db_${DB_CACHE_VERSION}_${docRef.collectionName}_${cleanId}`;
  // 第二十轮修复：记下写前缓存，服务端写入失败（返回 false）时回滚本地缓存——旧实现
  // 失败也保留新值，配合 getDocs 的 30 秒防删保护，假数据会在列表里「假活」半分钟。
  let prevCacheValue: string | null = null;
  try { prevCacheValue = localStorage.getItem(cacheKey); } catch (_) {}
  try {
    if (isMerge) {
      const existing = localStorage.getItem(cacheKey);
      const parsed = existing ? JSON.parse(existing) : {};
      const merged = { ...parsed, ...data, _lastLocalWriteTime: Date.now() };
      safeSetItem(cacheKey, JSON.stringify(merged));
    } else {
      safeSetItem(cacheKey, JSON.stringify({ ...data, _lastLocalWriteTime: Date.now() }));
    }
  } catch (_) {}

  // Dispatch local event for sub-second reactive sync
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('db_doc_updated', {
      detail: { col: docRef.collectionName, id: cleanId, data }
    }));
  }

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        col: docRef.collectionName,
        id: cleanId,
        data: { ...data, _appVersion: 'V2.0', _writeTime: new Date().toISOString() },
        merge: isMerge,
        appVersion: 'V2.0'
      })
    });
    if (!res.ok) {
      const setErr: any = new Error(`DB Set failed: ${res.status} ${res.statusText}`); setErr.status = res.status; throw setErr;
    }
    return true;
  } catch (err) {
    // M8修复：401/403清token并抛出
    // 2026-10-15 P1-7：网络错误返回false（而非true），让调用方能检测到服务端写入失败，避免"假成功"误报
    if (isAuthError(err)) {
      clearAuthTokenOn401();
      throw err;
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    try {
      if (prevCacheValue !== null) localStorage.setItem(cacheKey, prevCacheValue);
      else localStorage.removeItem(cacheKey);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('db_doc_updated', { detail: { col: docRef.collectionName, id: cleanId } }));
      }
    } catch (_) {}
    console.warn('[dbProxy.setDoc] 网络错误，服务端写入失败（本地缓存已回滚）:', (err as any)?.message || err);
    return false;
  }
}

export async function updateDoc(docRef: any, data: any) {
  invalidateReadCache(docRef.collectionName, String(docRef.id || '').replace(/\s+/g, '').trim());
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/update`;
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();

  // Merge locally in mock store first
  const cacheKey = `mock_db_${DB_CACHE_VERSION}_${docRef.collectionName}_${cleanId}`;
  try {
    const current = localStorage.getItem(cacheKey);
    const parsed = current ? JSON.parse(current) : {};
    const merged = { ...parsed, ...data };
    safeSetItem(cacheKey, JSON.stringify(merged));
  } catch (_) {}

  // Dispatch local event for sub-second reactive sync
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('db_doc_updated', {
      detail: { col: docRef.collectionName, id: cleanId, data }
    }));
  }

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        col: docRef.collectionName,
        id: cleanId,
        data
      })
    });
    if (!res.ok) {
      const updErr: any = new Error(`DB Update failed: ${res.status} ${res.statusText}`); updErr.status = res.status; throw updErr;
    }
    return true;
  } catch (err) {
    // M8修复：401/403清token并抛出
    // 2026-10-15 P1-7：网络错误返回false（而非true），让调用方能检测到服务端写入失败
    if (isAuthError(err)) {
      clearAuthTokenOn401();
      throw err;
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    console.warn('[dbProxy.updateDoc] 网络错误，服务端写入失败（本地缓存已更新）:', (err as any)?.message || err);
    return false;
  }
}

export async function deleteDoc(docRef: any) {
  invalidateReadCache(docRef.collectionName, String(docRef.id || '').replace(/\s+/g, '').trim());
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/delete`;
  const cleanId = String(docRef.id || '').replace(/\s+/g, '').trim();

  const cacheKey = `mock_db_${DB_CACHE_VERSION}_${docRef.collectionName}_${cleanId}`;
  try {
    localStorage.removeItem(cacheKey);
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        col: docRef.collectionName,
        id: cleanId
      })
    });
    if (!res.ok) {
      const delErr: any = new Error(`DB Delete failed: ${res.status} ${res.statusText}`); delErr.status = res.status; throw delErr;
    }
    return true;
  } catch (err) {
    // M8修复：401/403清token并抛出
    // 第四轮修复（P1-1）：网络错误返回false（与setDoc一致的诚实契约），让调用方能检测服务端删除失败，避免"假成功"
    if (isAuthError(err)) {
      clearAuthTokenOn401();
      throw err;
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    console.warn('[dbProxy.deleteDoc] 网络错误，服务端删除失败（本地缓存已移除）:', (err as any)?.message || err);
    return false;
  }
}

export async function addDoc(collectionRef: any, data: any) {
  invalidateReadCache(collectionRef.collectionName);
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/add`;
  const randomId = 'doc_' + Math.random().toString(36).substring(2, 11);
  
  const tempCacheKey = `mock_db_${DB_CACHE_VERSION}_${collectionRef.collectionName}_${randomId}`;
  try {
    localStorage.setItem(tempCacheKey, JSON.stringify(data));
  } catch (_) {}

  try {
    const res = await safeFetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        col: collectionRef.collectionName,
        data
      })
    });
    if (!res.ok) {
      const addErr: any = new Error(`DB Add failed: ${res.status} ${res.statusText}`); addErr.status = res.status; throw addErr;
    }
    const result = await res.json();
    const finalId = result.id || randomId;
    
    // Clean up temporary pre-cache key and update with real server document ID
    try {
      localStorage.removeItem(tempCacheKey);
      localStorage.setItem(`mock_db_${DB_CACHE_VERSION}_${collectionRef.collectionName}_${finalId}`, JSON.stringify(data));
    } catch (_) {}

    return { id: finalId };
  } catch (err) {
    try { localStorage.removeItem(tempCacheKey); } catch (_) {}
    // M8修复：addDoc失败直接抛出，不再返回假id
    // P1-1修复 2026-10-19：403 只抛错不清 token
    if (isAuthError(err)) {
      clearAuthTokenOn401();
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    throw err;
  }
}

export function getDocs(queryRefOrColRef: any): Promise<ProxyQuerySnapshot> {
  const colName = queryRefOrColRef.collectionName;
  const constraints = queryRefOrColRef.constraints || [];
  const key = `list:${colName}:${constraints.length ? JSON.stringify(constraints) : ''}`;
  return dedupedRead(key, () => getDocsUncached(queryRefOrColRef));
}

// 2026-10-24 第四十二轮续修5：列表增量订阅状态。此前 onSnapshot 轮询每次全量拉表
// （driver_users 单表 94KB、5 秒一轮）。现改为：首次/每 60 秒全量（对账删除），
// 其间带 since 水位只拉增量并按 id 合并。水位由服务端在响应 watermark 回传
// （MySQL=max(updated_at)，JSON 模式=查询时刻）。状态按「集合+token 尾段」键控，
// 换账号登录不会串上一个账号的合并结果；写操作经 invalidateReadCache 同步清状态，
// 本端写完下一轮必走全量。
const _listIncr = new Map<string, { byId: Map<string, any>; watermark: string | null; lastFullAt: number }>();
const LIST_FULL_RECONCILE_MS = 60 * 1000;
function listIncrKey(colName: string): string {
  let tail = '';
  try { tail = String(localStorage.getItem('dd_auth_token') || '').slice(-8); } catch (_) {}
  return `${colName}|${tail}`;
}

async function getDocsUncached(queryRefOrColRef: any): Promise<ProxyQuerySnapshot> {
  const baseUrl = getBaseApiUrl();
  const colName = queryRefOrColRef.collectionName;
  const constraints = queryRefOrColRef.constraints || [];
  const useIncr = !constraints || constraints.length === 0;
  const incrKey = listIncrKey(colName);
  const incrState = useIncr ? _listIncr.get(incrKey) : undefined;
  const wantFull = !useIncr || !incrState || !incrState.watermark || (Date.now() - incrState.lastFullAt >= LIST_FULL_RECONCILE_MS);

  let url = `${baseUrl}/api/db/list?col=${encodeURIComponent(colName)}`;
  if (constraints.length > 0) {
    url += `&constraints=${encodeURIComponent(JSON.stringify(constraints))}`;
  }
  if (!wantFull && incrState && incrState.watermark) {
    url += `&since=${encodeURIComponent(incrState.watermark)}`;
  }
  // 2026-10-17：加时间戳 + no-store，防 304 命中旧缓存造成状态污染
  url += `${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;

  try {
    const res = await safeFetchWithTimeout(url, { cache: 'no-store', headers: { ...getAuthHeaders() } });
    if (!res.ok) {
      const lErr: any = new Error(`DB Query failed: ${res.status} ${res.statusText}`);
      lErr.status = res.status;
      throw lErr;
    }
    const result = await res.json();
    let effectiveRawDocs: any[] = result.docs || [];
    if (useIncr) {
      if (wantFull) {
        const byId = new Map<string, any>();
        for (const d of effectiveRawDocs) { if (d && d.id) byId.set(String(d.id), d); }
        _listIncr.set(incrKey, { byId, watermark: result.watermark || null, lastFullAt: Date.now() });
      } else if (incrState) {
        for (const d of effectiveRawDocs) { if (d && d.id) incrState.byId.set(String(d.id), d); }
        if (result.watermark) incrState.watermark = result.watermark;
        effectiveRawDocs = Array.from(incrState.byId.values());
      }
    }
    const docs = effectiveRawDocs.map((docItem: any) => {
      return new ProxyDocumentSnapshot(docItem.id, docItem.data, true);
    });

    // Synchronize localStorage cache with authoritative server state:
    // Remove stale/deleted local keys that no longer exist on server for this collection,
    // but protect recently written local entries (< 30 seconds) to prevent flickering.
    // 2026-10-24 第四十二轮续修6：整段缓存同步推迟到快照交付之后（setTimeout 0）。
    // 此前它在 return 前同步执行——全量轮要把整表逐条 JSON.stringify 写进
    // localStorage（driver_users 约 94KB），切回前台多个订阅同时完成时主线程
    // 被这批同步写占满，表现为 1-2 秒点不动。缓存晚一个宏任务落盘不影响正确性
    // （网络失败兜底读的是上一轮已落盘的缓存）。
    const syncLocalCache = () => {
    try {
      if (!constraints || constraints.length === 0) {
        // 第四十二轮续修5：修剪（删本地已消失文档）只在全量轮做——增量轮的结果集
        // 只是变更子集，拿它当全集修剪会把未变更文档误判为已删除。
        if (wantFull) {
          const serverDocIds = new Set((result.docs || []).map((d: any) => String(d.id)));
          const prefix = `mock_db_${DB_CACHE_VERSION}_${colName}_`;
          const now = Date.now();
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
              const docId = key.substring(prefix.length);
              if (!serverDocIds.has(docId)) {
                try {
                  const cached = localStorage.getItem(key);
                  if (cached) {
                    const parsed = JSON.parse(cached);
                    const writeTime = Number(parsed._lastLocalWriteTime || parsed.timestamp || parsed.createdAt || 0);
                    if (writeTime > 0 && (now - writeTime) < 30000) {
                      // Do not remove recent local doc
                      continue;
                    }
                  }
                } catch (_) {}
                localStorage.removeItem(key);
              }
            }
          }
        }
        (result.docs || []).forEach((d: any) => {
          if (d && d.id) {
            localStorage.setItem(`mock_db_${DB_CACHE_VERSION}_${colName}_${d.id}`, JSON.stringify({ ...(d.data || {}), _cachedAt: Date.now() }));
          }
        });
      }
    } catch (_) {}
    };
    setTimeout(syncLocalCache, 0);

    return new ProxyQuerySnapshot(docs);
  } catch (err) {
    // 第四十二轮续修5：增量轮失败即弃状态，下一轮回到全量，防坏水位卡住增量链
    if (useIncr && !wantFull) _listIncr.delete(incrKey);
    // 2026-10-17根治：401/403 是鉴权失败，不是"空集合"，必须清 token 并抛出，
    // 绝不能回退本地旧缓存（否则 401 后 App 会用 stale 数据渲染，造成状态污染）。
    if (isAuthError(err)) {
      clearAuthTokenOn401();
      throw err;
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    console.warn("Proxy DB Query falling back to local simulation:", err);
    // Sweep localStorage to retrieve matching cached documents
    // 2026-10-23 视角深挖修复：旧实现对司机集合在网络失败时整表归零（跳过缓存），
    // 小队名单/申请名单随弱网抖动整表闪没、闪现。与 getDoc 同口径改走缓存兜底；
    // 成功路径的同步修剪仍负责删除已消失文档，口径不变。
    const docList: ProxyDocumentSnapshot[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`mock_db_${DB_CACHE_VERSION}_${colName}_`)) {
          const docId = key.substring(`mock_db_${DB_CACHE_VERSION}_${colName}_`.length);
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

  // Instant local reactive sync listener
  const handleLocalUpdate = (e: any) => {
    if (isUnsubscribed) return;
    const detail = e.detail;
    if (!detail) return;
    if (targetRef.type === 'document') {
      const cleanId = String(targetRef.id || '').replace(/\s+/g, '').trim();
      if (detail.col === targetRef.collectionName && detail.id === cleanId) {
        checkUpdate();
      }
    } else {
      if (detail.col === targetRef.collectionName) {
        checkUpdate();
      }
    }
  };

  let bc: BroadcastChannel | null = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('db_doc_updated', handleLocalUpdate);
    try {
      bc = new BroadcastChannel('daijia_db_sync');
      bc.onmessage = () => {
        if (!isUnsubscribed) checkUpdate();
      };
    } catch (_) {}
  }

  // Adaptive polling: P0-2优化 5000ms 可见/30000ms 后台（原 1500/8000），支撑3000并发
  const getPollInterval = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      return 30000;
    }
    return 5000;
  };

  let pollTimer: any = null;
  const scheduleNextPoll = () => {
    if (isUnsubscribed) return;
    pollTimer = setTimeout(async () => {
      if (!isUnsubscribed) {
        await checkUpdate();
        scheduleNextPoll();
      }
    }, getPollInterval());
  };

  scheduleNextPoll();

  const handleVisibilityChange = () => {
    if (isUnsubscribed) return;
    if (typeof document !== 'undefined' && !document.hidden) {
      // 卡顿修复：切回前台时不再每个订阅各自立即发请求，
      // 改走全局协调器错峰（normal 优先级），避免 15 个订阅同时开火堵死主线程
      const taskId = `dbproxy-resume-${targetRef.collectionName}-${targetRef.type === 'document' ? targetRef.id : 'col'}`;
      scheduleResumeTask(taskId, 'normal', () => {
        if (!isUnsubscribed) checkUpdate();
      });
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return () => {
    isUnsubscribed = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('db_doc_updated', handleLocalUpdate);
    }
    if (bc) {
      try { bc.close(); } catch (_) {}
    }
  };
}

export async function clearCollection(colName: string) {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api/db/clear-collection`;

  // Clean up local storage caches for this collection
  try {
    const prefix = `mock_db_${DB_CACHE_VERSION}_${colName}_`;
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
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ col: colName })
    });
    if (!res.ok) {
      const clrErr: any = new Error(`DB Clear Collection failed: ${res.status} ${res.statusText}`); clrErr.status = res.status; throw clrErr;
    }
    return true;
  } catch (err) {
    // M8修复：401/403清token并抛出
    if (isAuthError(err)) {
      clearAuthTokenOn401();
      throw err;
    }
    if (isForbiddenError(err)) {
      throw err;
    }
    // 第四轮修复（P1-1）：网络错误返回false（与setDoc一致的诚实契约），调用方据此如实提示，不再假报清空成功
    console.warn('[dbProxy.clearCollection] 网络错误，服务端清空失败（本地缓存已清理）:', (err as any)?.message || err);
    return false;
  }
}
