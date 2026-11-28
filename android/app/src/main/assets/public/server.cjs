#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  AUTHORITATIVE_REAL_DRIVER_NAMES: () => AUTHORITATIVE_REAL_DRIVER_NAMES
});
module.exports = __toCommonJS(server_exports);
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_child_process = require("child_process");
var import_promise = __toESM(require("mysql2/promise"), 1);
var import_vite = require("vite");
var $Dypnsapi20170525 = __toESM(require("@alicloud/dypnsapi20170525"), 1);
var $OpenApi = __toESM(require("@alicloud/openapi-client"), 1);
var DEFAULT_ALI_KEY_ID = Buffer.from("TFRBSTV0N0JSeGM1YTZNRXl6Y1lMWE9B", "base64").toString("utf8");
var DEFAULT_ALI_KEY_SECRET = Buffer.from("cmVtU1ZOYms4WVFrcnh5VVMwRzR3blVrSHRZclJJ", "base64").toString("utf8");
function getDypnsClient() {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    return null;
  }
  let OpenApiConfigClass = $OpenApi.Config;
  if (typeof OpenApiConfigClass !== "function") {
    OpenApiConfigClass = $OpenApi.default?.Config;
  }
  let DypnsClientClass = $Dypnsapi20170525.default;
  if (typeof DypnsClientClass !== "function") {
    if (DypnsClientClass && typeof DypnsClientClass.default === "function") {
      DypnsClientClass = DypnsClientClass.default;
    } else if ($Dypnsapi20170525 && typeof $Dypnsapi20170525.default === "function") {
      DypnsClientClass = $Dypnsapi20170525.default;
    } else if ($Dypnsapi20170525 && typeof $Dypnsapi20170525.Client === "function") {
      DypnsClientClass = $Dypnsapi20170525.Client;
    }
  }
  if (typeof OpenApiConfigClass !== "function") {
    throw new Error("Alibaba Cloud OpenAPI Config class constructor could not be resolved");
  }
  if (typeof DypnsClientClass !== "function") {
    throw new Error("Alibaba Cloud Dypns Client class constructor could not be resolved");
  }
  const config = new OpenApiConfigClass({
    accessKeyId,
    accessKeySecret,
    endpoint: "dypnsapi.aliyuncs.com"
  });
  return new DypnsClientClass(config);
}
var verificationCodes = /* @__PURE__ */ new Map();
var dispatchOrderLocks = /* @__PURE__ */ new Map();
var _issuedOrderNos = /* @__PURE__ */ new Set();
var _orderNoByOrderId = /* @__PURE__ */ new Map();
var verifyFailures = /* @__PURE__ */ new Map();
var smsSendLogs = /* @__PURE__ */ new Map();
var smsVerifyIpLogs = /* @__PURE__ */ new Map();
var AUTH_TOKENS_PATH = (() => {
  try {
    const path2 = require("path");
    return path2.join(path2.dirname(LOCAL_JSON_DB_PATH), "auth_tokens.json");
  } catch (_) {
    return "./auth_tokens.json";
  }
})();
var authTokens = /* @__PURE__ */ new Map();
try {
  let loaded = false;
  if (import_fs.default.existsSync(AUTH_TOKENS_PATH)) {
    try {
      const raw = import_fs.default.readFileSync(AUTH_TOKENS_PATH, "utf8");
      const obj = JSON.parse(raw || "{}");
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") authTokens.set(k, v);
      }
      loaded = true;
      console.log(`[Auth] \u5DF2\u4ECE\u6587\u4EF6\u52A0\u8F7D ${authTokens.size} \u4E2A token`);
    } catch (_) {
      const bakPath = AUTH_TOKENS_PATH + ".bak";
      if (import_fs.default.existsSync(bakPath)) {
        const rawBak = import_fs.default.readFileSync(bakPath, "utf8");
        const objBak = JSON.parse(rawBak || "{}");
        for (const [k, v] of Object.entries(objBak)) {
          if (v && typeof v === "object") authTokens.set(k, v);
        }
        loaded = true;
        console.log(`[Auth] \u4E3B\u6587\u4EF6\u635F\u574F\uFF0C\u5DF2\u4ECE\u5907\u4EFD\u52A0\u8F7D ${authTokens.size} \u4E2A token`);
      }
    }
  }
  if (!loaded) console.log("[Auth] \u65E0\u53EF\u7528 token \u6587\u4EF6\uFF0C\u4ECE\u7A7A\u5F00\u59CB");
} catch (e) {
  console.error("[Auth] \u52A0\u8F7D token \u6587\u4EF6\u5931\u8D25:", e?.message);
}
function persistAuthTokensSync() {
  try {
    const obj = {};
    for (const [k, v] of authTokens) obj[k] = v;
    const tmp = AUTH_TOKENS_PATH + ".tmp";
    import_fs.default.writeFileSync(tmp, JSON.stringify(obj), "utf8");
    import_fs.default.renameSync(tmp, AUTH_TOKENS_PATH);
  } catch (e) {
    console.error("[Auth] \u6301\u4E45\u5316 token \u5931\u8D25:", e?.message);
  }
}
var _authTokensDirty = false;
setInterval(() => {
  if (!_authTokensDirty) return;
  _authTokensDirty = false;
  persistAuthTokensSync();
}, 1e4);
function getLicenseDaysRemaining(expiry) {
  const s = String(expiry || "").trim();
  if (!s || s === "\u5F85\u5F00\u901A" || s === "\u5F85\u6FC0\u6D3B" || s === "\u672A\u5F00\u901A" || s === "\u5DF2\u5230\u671F" || s === "\u5DF2\u8FC7\u671F") return 0;
  if (s === "\u6C38\u4E45\u6709\u6548" || s === "\u6C38\u4E45" || s === "\u7EC8\u8EAB" || s === "permanent") return 99999;
  let year = 0, month = 0, day = 0;
  const dateOnly = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    year = parseInt(dateOnly[1], 10);
    month = parseInt(dateOnly[2], 10) - 1;
    day = parseInt(dateOnly[3], 10);
  } else {
    const parsed = Date.parse(s);
    if (isNaN(parsed)) return 0;
    const d = new Date(parsed);
    year = d.getFullYear();
    month = d.getMonth();
    day = d.getDate();
  }
  const expDate = new Date(year, month, day, 0, 0, 0, 0);
  const now = /* @__PURE__ */ new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1e3 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}
function isLicenseValid(expiry) {
  return getLicenseDaysRemaining(expiry) > 0;
}
function mysqlQueryTimeout(pool, sql, params, ms, label) {
  return Promise.race([
    pool.query({ sql, timeout: ms }, params),
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error(`[MySQL\u8D85\u65F6] ${label} \u8D85\u8FC7 ${ms}ms`)), ms)
    )
  ]);
}
function isVipActiveServer(vipExpiry) {
  if (!vipExpiry) return false;
  const s = String(vipExpiry).trim();
  if (s === "0" || s === "0\u5929" || s === "\u672A\u6FC0\u6D3B" || s === "\u5F85\u6FC0\u6D3B" || s === "\u5F85\u5F00\u901A" || s === "\u672A\u5F00\u901A" || s === "\u5DF2\u5230\u671F" || s === "\u5DF2\u8FC7\u671F" || s === "") return false;
  if (s === "\u6C38\u4E45\u6709\u6548" || s === "\u6C38\u4E45" || s === "\u7EC8\u8EAB" || s === "permanent") return true;
  try {
    const match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    let expDate;
    if (match) {
      expDate = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 23, 59, 59, 999);
    } else {
      expDate = new Date(s);
    }
    if (isNaN(expDate.getTime())) return false;
    return expDate.getTime() > Date.now();
  } catch (_) {
    return false;
  }
}
function getBeijingTodayStr() {
  return beijingDayStrOf(Date.now());
}
function beijingDayStrOf(tsMs) {
  return new Date(Number(tsMs) + 8 * 60 * 60 * 1e3 - 6 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
async function countTodayCompletedOrders(driverPhone) {
  const todayStr = getBeijingTodayStr();
  let count = 0;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows] = await mysqlQueryTimeout(
        mysqlPool,
        `SELECT
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.dispatchedDriverPhone')) AS dphone,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.claimedDriverPhone')) AS cphone,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.driverPhone')) AS phone,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.completedAt')) AS completedAt,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.updatedAt')) AS updatedAt,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.timestamp')) AS ts
         FROM \`daijia_documents\`
         WHERE \`collection\` = 'merchant_orders'
           AND JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.status')) = 'completed'`,
        [],
        8e3,
        "\u4ECA\u65E5\u5B8C\u6210\u5355\u6570\u7EDF\u8BA1"
      );
      for (const r of rows || []) {
        try {
          const dPhone = String(r.phone || r.cphone || r.dphone || "").replace(/\D/g, "");
          if (dPhone !== driverPhone) continue;
          const ts = r.completedAt || r.updatedAt || r.ts;
          if (!ts || ts === "null") continue;
          const bjt = beijingDayStrOf(Number(ts));
          if (bjt === todayStr) count++;
        } catch (_) {
        }
      }
    } else {
      const dbData = readLocalJsonDb();
      const orders = dbData["merchant_orders"] || {};
      for (const o of Object.values(orders)) {
        const dPhone = String(o.driverPhone || o.claimedDriverPhone || o.dispatchedDriverPhone || "").replace(/\D/g, "");
        if (dPhone !== driverPhone) continue;
        if (o.status !== "completed") continue;
        const ts = o.completedAt || o.updatedAt || o.timestamp;
        if (!ts) continue;
        const bjt = beijingDayStrOf(Number(ts));
        if (bjt === todayStr) count++;
      }
    }
  } catch (e) {
    console.error("[CountOrders] \u7EDF\u8BA1\u5931\u8D25:", e?.message);
  }
  return count;
}
async function countTodayReportTransfers(reporterPhone) {
  const todayStr = getBeijingTodayStr();
  let count = 0;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows] = await mysqlQueryTimeout(
        mysqlPool,
        `SELECT
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.orderId')) AS orderId,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.id')) AS id,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.reporterPhone')) AS reporterPhone,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.createdAt')) AS createdAt,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.timestamp')) AS ts,
           JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.dispatchedAt')) AS dispatchedAt
         FROM \`daijia_documents\`
         WHERE \`collection\` = 'merchant_orders'`,
        [],
        8e3,
        "\u4ECA\u65E5\u8F6C\u5355\u6B21\u6570\u7EDF\u8BA1"
      );
      for (const r of rows || []) {
        try {
          const oid = String(r.orderId && r.orderId !== "null" ? r.orderId : r.id && r.id !== "null" ? r.id : "");
          if (!oid.startsWith("RT")) continue;
          const rp = String(r.reporterPhone || "").replace(/\D/g, "");
          if (rp !== reporterPhone) continue;
          const ts = (r.createdAt && r.createdAt !== "null" ? r.createdAt : null) || (r.ts && r.ts !== "null" ? r.ts : null) || (r.dispatchedAt && r.dispatchedAt !== "null" ? r.dispatchedAt : null);
          if (!ts) continue;
          const bjt = beijingDayStrOf(Number(ts));
          if (bjt === todayStr) count++;
        } catch (_) {
        }
      }
    } else {
      const dbData = readLocalJsonDb();
      const orders = dbData["merchant_orders"] || {};
      for (const o of Object.values(orders)) {
        const oid = String(o.orderId || o.id || "");
        if (!oid.startsWith("RT")) continue;
        const rp = String(o.reporterPhone || "").replace(/\D/g, "");
        if (rp !== reporterPhone) continue;
        const ts = o.createdAt || o.timestamp || o.dispatchedAt;
        if (!ts) continue;
        const bjt = beijingDayStrOf(Number(ts));
        if (bjt === todayStr) count++;
      }
    }
  } catch (e) {
    console.error("[CountRT] \u7EDF\u8BA1\u5931\u8D25:", e?.message);
  }
  return count;
}
async function ensureTokenReverseRecord(cleanPhone, token, scope, isMerchant) {
  const tokenKey = `t:${token}`;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
        ["auth_tokens", tokenKey]
      );
      if (rows && rows.length > 0) {
        let d = null;
        try {
          d = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
        } catch (_) {
          d = null;
        }
        if (d && d.phone) return;
      }
      const tokenData = JSON.stringify({ phone: cleanPhone, scope: String(scope || "driver"), isMerchant: !!isMerchant, createdAt: (/* @__PURE__ */ new Date()).toISOString(), healed: true });
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["auth_tokens", tokenKey, tokenData]
      ).catch(() => {
      });
    } else {
      const dbData = readLocalJsonDb() || {};
      if (!dbData.auth_tokens) dbData.auth_tokens = {};
      const cur = dbData.auth_tokens[tokenKey];
      if (cur && cur.phone) return;
      dbData.auth_tokens[tokenKey] = { phone: cleanPhone, scope: String(scope || "driver"), isMerchant: !!isMerchant, createdAt: (/* @__PURE__ */ new Date()).toISOString(), healed: true };
      writeLocalJsonDb(dbData);
    }
  } catch (_) {
  }
}
async function getOrCreatePersistentToken(phone, scope, isMerchant) {
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone) throw new Error("\u624B\u673A\u53F7\u4E3A\u7A7A");
  const phoneKey = `p:${cleanPhone}`;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
        ["auth_tokens", phoneKey]
      );
      if (rows && rows.length > 0) {
        const d = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
        if (d && d.token) {
          const existingToken = String(d.token);
          await ensureTokenReverseRecord(cleanPhone, existingToken, scope, isMerchant);
          return existingToken;
        }
      }
    } else {
      const dbData = readLocalJsonDb() || {};
      const existing = dbData?.auth_tokens?.[phoneKey];
      if (existing && existing.token) {
        const existingToken = String(existing.token);
        await ensureTokenReverseRecord(cleanPhone, existingToken, scope, isMerchant);
        return existingToken;
      }
    }
  } catch (_) {
  }
  const newToken = "st_" + import_crypto.default.randomBytes(32).toString("hex");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const tokenKey = `t:${newToken}`;
  const phoneData = JSON.stringify({ token: newToken, phone: cleanPhone, createdAt: now });
  const tokenData = JSON.stringify({ phone: cleanPhone, scope: String(scope || "driver"), isMerchant: !!isMerchant, createdAt: now });
  try {
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["auth_tokens", phoneKey, phoneData]
      ).catch(() => {
      });
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["auth_tokens", tokenKey, tokenData]
      ).catch(() => {
      });
      try {
        const [vrows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          ["auth_tokens", phoneKey]
        );
        if (vrows && vrows.length > 0) {
          const vd = typeof vrows[0].data === "string" ? JSON.parse(vrows[0].data) : vrows[0].data;
          const winnerToken = vd && vd.token ? String(vd.token) : "";
          if (winnerToken && winnerToken !== newToken) {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
              ["auth_tokens", tokenKey]
            ).catch(() => {
            });
            await ensureTokenReverseRecord(cleanPhone, winnerToken, scope, isMerchant);
            return winnerToken;
          }
        }
      } catch (_) {
      }
    } else {
      const dbData = readLocalJsonDb() || {};
      if (!dbData.auth_tokens) dbData.auth_tokens = {};
      dbData.auth_tokens[phoneKey] = JSON.parse(phoneData);
      dbData.auth_tokens[tokenKey] = JSON.parse(tokenData);
      writeLocalJsonDb(dbData);
    }
  } catch (_) {
  }
  await ensureTokenReverseRecord(cleanPhone, newToken, scope, isMerchant);
  return newToken;
}
var _dispatchPoolsCache = null;
var DISPATCH_POOL_TTL_MS = 3e3;
async function dispatchPoolsStamp() {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT MAX(`updated_at`) AS m FROM `daijia_documents` WHERE `collection` IN ('squad_members','driver_users')"
      );
      return String(rows?.[0]?.m || "");
    } catch (_) {
      return "";
    }
  }
  return "";
}
async function getDispatchPoolsCached() {
  const c = _dispatchPoolsCache;
  if (!c) return null;
  if (Date.now() - c.at >= DISPATCH_POOL_TTL_MS) return null;
  if (isMySQLEnabled && mysqlPool) {
    const stamp = await dispatchPoolsStamp();
    if (!stamp || stamp !== c.stamp) return null;
  }
  return c;
}
async function saveDispatchPoolsCache(pools) {
  const stamp = await dispatchPoolsStamp();
  _dispatchPoolsCache = { at: Date.now(), stamp, squadList: pools.squadList, locationMap: pools.locationMap, driverDocMap: pools.driverDocMap };
}
var _persistentTokenCache = /* @__PURE__ */ new Map();
var TOKEN_VERIFY_CACHE_TTL_MS = 60 * 1e3;
function invalidatePersistentTokenCacheByPhone(phone) {
  const p = String(phone || "").trim();
  for (const [k, v] of Array.from(_persistentTokenCache.entries())) {
    if (v.phone === p) _persistentTokenCache.delete(k);
  }
}
async function verifyPersistentToken(token) {
  const t = String(token || "").trim();
  if (!t || !t.startsWith("st_")) return null;
  const cachedHit = _persistentTokenCache.get(t);
  if (cachedHit && Date.now() - cachedHit.at < TOKEN_VERIFY_CACHE_TTL_MS) {
    return { phone: cachedHit.phone, scope: cachedHit.scope, isMerchant: cachedHit.isMerchant };
  }
  const tokenKey = `t:${t}`;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
        ["auth_tokens", tokenKey]
      );
      if (rows && rows.length > 0) {
        const d = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
        if (d && d.phone) {
          const out = { phone: String(d.phone), scope: String(d.scope || "driver"), isMerchant: !!d.isMerchant };
          _persistentTokenCache.set(t, { ...out, at: Date.now() });
          return out;
        }
      }
    } else {
      const dbData = readLocalJsonDb() || {};
      const d = dbData?.auth_tokens?.[tokenKey];
      if (d && d.phone) {
        const out = { phone: String(d.phone), scope: String(d.scope || "driver"), isMerchant: !!d.isMerchant };
        _persistentTokenCache.set(t, { ...out, at: Date.now() });
        return out;
      }
    }
  } catch (_) {
  }
  return null;
}
function latestTimeMs(...vals) {
  let m = 0;
  for (const v of vals) {
    if (v === void 0 || v === null || v === "") continue;
    const num = Number(v);
    const n = isNaN(num) ? new Date(v).getTime() : num;
    if (n > m) m = n;
  }
  return m;
}
function docLatestTimeMs(doc) {
  if (!doc) return 0;
  return latestTimeMs(
    doc.onlineSessionTime,
    doc.lastLocationTime,
    doc.locationTimestamp,
    doc.timestamp,
    doc.lastStatusUpdateTime,
    doc.lastUpdatedTime,
    doc.updatedAt
  );
}
var _locMysqlFlushAt = /* @__PURE__ */ new Map();
var _todayOrderCountsCache = null;
async function getTodayOrderCounts() {
  if (_todayOrderCountsCache && Date.now() - _todayOrderCountsCache.at < 5e3) {
    return _todayOrderCountsCache.map;
  }
  const map = /* @__PURE__ */ new Map();
  const BJ_MS = 8 * 3600 * 1e3;
  const businessDayKey = (t) => {
    const s = new Date(t + BJ_MS - 6 * 3600 * 1e3);
    return `${s.getUTCFullYear()}-${s.getUTCMonth()}-${s.getUTCDate()}`;
  };
  const todayKey = businessDayKey(Date.now());
  const nowBJ = new Date(Date.now() + BJ_MS);
  let windowStartUtcMs = Date.UTC(nowBJ.getUTCFullYear(), nowBJ.getUTCMonth(), nowBJ.getUTCDate(), 6, 0, 0) - BJ_MS;
  if (nowBJ.getUTCHours() < 6) windowStartUtcMs -= 24 * 3600 * 1e3;
  const consider = (doc) => {
    try {
      if (!doc || typeof doc !== "object") return;
      const oStatus = String(doc.status || "");
      const oCat = String(doc.statusCategory || "");
      if (doc.isTransferIssuer === true || oStatus === "\u5DF2\u8F6C\u5355" || oStatus === "cancelled" || oCat === "\u5DF2\u53D6\u6D88" || doc.isCancelled === true) return;
      const isCompletion = doc.isCompleted === true || ["\u5DF2\u652F\u4ED8", "\u5DF2\u5B8C\u6210", "completed", "paid", "finished", "settled"].includes(oStatus) || ["\u5DF2\u5B8C\u6210", "\u5DF2\u652F\u4ED8", "\u5DF2\u7ED3\u5355"].includes(oCat);
      if (!isCompletion) return;
      const driver = String(doc.driverPhone || doc.claimedDriverPhone || doc.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
      if (!driver) return;
      let t = 0;
      if (typeof doc.timestamp === "number" && isFinite(doc.timestamp) && doc.timestamp > 0) t = doc.timestamp;
      else {
        const ds = doc.fullTimeStr || doc.timeStr || doc.createdTime || doc.createdAt || doc.completedAt;
        const p = ds ? Date.parse(String(ds)) : NaN;
        if (!isNaN(p)) t = p;
      }
      if (!t || businessDayKey(t) !== todayKey) return;
      map.set(driver, (map.get(driver) || 0) + 1);
    } catch (_) {
    }
  };
  let scanned = false;
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = 'merchant_orders' AND UNIX_TIMESTAMP(`updated_at`) >= ?",
        [Math.floor(windowStartUtcMs / 1e3)]
      );
      (rows || []).forEach((r) => {
        try {
          consider(typeof r.data === "string" ? JSON.parse(r.data) : r.data);
        } catch (_) {
        }
      });
      scanned = true;
    } catch (_) {
    }
  }
  if (!scanned) {
    try {
      const mo = readLocalJsonDb()?.["merchant_orders"] || {};
      Object.keys(mo).forEach((k) => consider(mo[k]));
    } catch (_) {
    }
  }
  _todayOrderCountsCache = { at: Date.now(), map };
  return map;
}
var _authoritativeNameCache = /* @__PURE__ */ new Map();
var _squadMembersLastGood = null;
async function getAuthoritativeDriverName(phone) {
  const p = String(phone || "").replace(/\D/g, "").trim();
  if (!p) return "";
  const hit = _authoritativeNameCache.get(p);
  if (hit && Date.now() - hit.at < 6e4) return hit.name;
  let name = "";
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
        ["squad_members", p]
      );
      if (rows && rows.length > 0) {
        const d = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
        const n = String(d?.name || d?.driverName || "").trim();
        if (n && !isGenericDriverName(n, p)) name = n;
      }
    } catch (_) {
    }
  }
  if (!name) {
    try {
      const d = readLocalJsonDb()?.["squad_members"]?.[p];
      const n = String(d?.name || d?.driverName || "").trim();
      if (n && !isGenericDriverName(n, p)) name = n;
    } catch (_) {
    }
  }
  if (!name) {
    try {
      name = await resolveRealNameFromRecords(p);
    } catch (_) {
    }
  }
  _authoritativeNameCache.set(p, { name, at: Date.now() });
  return name;
}
async function resolveRealNameFromRecords(p) {
  const sources = [
    ["squad_applications", ["name", "driverName", "applicantName"]],
    ["online_applications", ["name", "driverName", "applicantName"]],
    ["driver_users", ["name", "driverName"]]
  ];
  for (const [col, fields] of sources) {
    try {
      const doc = await Promise.resolve(readStatusDocument(col, p)).catch(() => null);
      if (doc) {
        for (const f of fields) {
          const n = String(doc[f] || "").trim();
          if (n && !isGenericDriverName(n, p)) return n.slice(0, 8);
        }
      }
    } catch (_) {
    }
    try {
      const doc = readLocalJsonDb()?.[col]?.[p];
      if (doc) {
        for (const f of fields) {
          const n = String(doc[f] || "").trim();
          if (n && !isGenericDriverName(n, p)) return n.slice(0, 8);
        }
      }
    } catch (_) {
    }
  }
  return "";
}
var DEVELOPER_PHONE_SERVER = "15509601222";
async function logAdminOperation(opType, operatorPhone, targetPhone, details, req) {
  try {
    const logId = `LOG${Date.now()}${Math.floor(Math.random() * 1e3)}`;
    const logData = {
      id: logId,
      opType,
      operatorPhone,
      targetPhone,
      details,
      ip: req?.ip || req?.headers?.["x-forwarded-for"] || "",
      timestamp: Date.now(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?)",
        ["admin_operation_logs", logId, JSON.stringify(logData)]
      ).catch(() => {
      });
    } else {
      const dbData = readLocalJsonDb();
      if (!dbData["admin_operation_logs"]) dbData["admin_operation_logs"] = {};
      dbData["admin_operation_logs"][logId] = logData;
      writeLocalJsonDb(dbData);
    }
  } catch (_) {
  }
}
setInterval(() => {
  const now = Date.now();
  try {
    for (const [k, v] of verificationCodes) {
      if (v.expiresAt < now) verificationCodes.delete(k);
    }
    for (const [k, v] of dispatchPhoneLoginLogs) {
      if (now - v > 25 * 3600 * 1e3) dispatchPhoneLoginLogs.delete(k);
    }
    for (const [k, v] of dispatchIpLoginLogs) {
      if (now - v > 25 * 3600 * 1e3) dispatchIpLoginLogs.delete(k);
    }
  } catch (_) {
  }
}, 10 * 60 * 1e3);
setInterval(async () => {
  try {
    const now = /* @__PURE__ */ new Date();
    const beijingMs = now.getTime() + now.getTimezoneOffset() * 6e4 + 8 * 36e5;
    const beijingDate = new Date(beijingMs);
    if (beijingDate.getHours() !== 4 || beijingDate.getMinutes() > 5) return;
    const cutoff = Date.now() - 24 * 3600 * 1e3;
    let deleted = 0;
    try {
      const dbData = readLocalJsonDb();
      if (dbData["merchant_orders"]) {
        for (const orderId in dbData["merchant_orders"]) {
          const o = dbData["merchant_orders"][orderId];
          if (o && (o.status === "hall" || o.in_hall === true)) {
            const hallAt = Number(o.hallAt || 0);
            if (hallAt && hallAt < cutoff) {
              delete dbData["merchant_orders"][orderId];
              deleted++;
            }
          }
        }
        if (deleted > 0) writeLocalJsonDb(dbData);
      }
    } catch (_) {
    }
    if (isMySQLEnabled && mysqlPool) {
      try {
        const [rows] = await mysqlPool.query(
          "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
          ["merchant_orders"]
        );
        for (const row of rows || []) {
          try {
            const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            if (d && (d.status === "hall" || d.in_hall === true)) {
              const hallAt = Number(d.hallAt || 0);
              if (hallAt && hallAt < cutoff) {
                await mysqlPool.query(
                  "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                  ["merchant_orders", row.doc_id]
                );
                deleted++;
              }
            }
          } catch (_) {
          }
        }
      } catch (_) {
      }
    }
    if (deleted > 0) console.log(`[HallArchive] \u5F52\u6863\u4E86 ${deleted} \u4E2A\u8FC7\u671F\u5927\u5385\u8BA2\u5355`);
  } catch (_) {
  }
}, 5 * 60 * 1e3);
var dispatchPhoneLoginLogs = /* @__PURE__ */ new Map();
var dispatchIpLoginLogs = /* @__PURE__ */ new Map();
var WHITELIST_PHONES = ["15509601222", "15121904440", "18695119126"];
var mysqlPool = null;
var isMySQLEnabled = false;
async function initDatabase() {
  const host = process.env.MYSQL_HOST;
  if (!host) {
    console.log("[Database] Running in Local File-based Database mode (local_db.json).");
    isMySQLEnabled = false;
    mysqlPool = null;
    return;
  }
  console.log(`[Database] Testing MySQL configuration for ${host}:${process.env.MYSQL_PORT || 3306}, Database: ${process.env.MYSQL_DATABASE}...`);
  const testPool = import_promise.default.createPool({
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 100,
    maxIdle: 50,
    idleTimeout: 6e4,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    queueLimit: 0,
    connectTimeout: 3e3,
    charset: "utf8mb4"
  });
  try {
    const conn = await testPool.getConnection();
    console.log("\u2713 [Database] Connected to MySQL database successfully!");
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`daijia_documents\` (
        \`collection\` VARCHAR(64) NOT NULL,
        \`doc_id\` VARCHAR(128) NOT NULL,
        \`data\` LONGTEXT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`collection\`, \`doc_id\`),
        INDEX \`idx_collection\` (\`collection\`),
        INDEX \`idx_col_updated\` (\`collection\`, \`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    conn.release();
    mysqlPool = testPool;
    isMySQLEnabled = true;
    console.log('\u2713 [Database] MySQL table structures "daijia_documents" verified successfully.');
    return;
  } catch (err) {
    testPool.end().catch(() => {
    });
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      try {
        const fallbackPool = import_promise.default.createPool({
          host: "127.0.0.1",
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 100,
          maxIdle: 50,
          idleTimeout: 6e4,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
          queueLimit: 0,
          connectTimeout: 2e3,
          charset: "utf8mb4"
        });
        const conn = await fallbackPool.getConnection();
        console.log('\u2713 [Database] Connected to local MySQL fallback "127.0.0.1" successfully!');
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`daijia_documents\` (
            \`collection\` VARCHAR(64) NOT NULL,
            \`doc_id\` VARCHAR(128) NOT NULL,
            \`data\` LONGTEXT NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`collection\`, \`doc_id\`),
            INDEX \`idx_collection\` (\`collection\`),
            INDEX \`idx_col_updated\` (\`collection\`, \`updated_at\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        conn.release();
        mysqlPool = fallbackPool;
        isMySQLEnabled = true;
        console.log("\u2713 [Database] MySQL table structures verified on local fallback.");
        return;
      } catch (fallbackErr) {
      }
    }
    console.log("\u2139\uFE0F [Database] Remote MySQL database not reachable. Seamlessly operating in Local File-based Database mode (local_db.json).");
    isMySQLEnabled = false;
    mysqlPool = null;
  }
}
var LOCAL_JSON_DB_PATH = import_path.default.join(process.cwd(), "local_db.json");
var cachedDbData = null;
var lastDbReadTime = 0;
var AUTHORITATIVE_REAL_DRIVER_NAMES = {
  "15509601222": "\u5434\u5F66\u7956"
};
function isGenericDriverName(name, phone) {
  const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
  if (AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone]) return false;
  if (!cleanPhone || cleanPhone.length !== 11) return true;
  if (!name || typeof name !== "string") return true;
  const clean = String(name).trim();
  if (!clean) return true;
  if (clean === "\u4EE3\u9A7E\u53F8\u673A" || clean === "\u5728\u7EBF\u4EE3\u9A7E\u53F8\u673A" || clean === "\u53F8\u673A" || clean === "\u672A\u547D\u540D" || clean === "\u4EE3\u9A7E\u5E08\u5085" || clean === "\u865A\u62DF\u53F8\u673A") return true;
  if (/^司机\d+/.test(clean)) return true;
  if (clean.startsWith("\u53F8\u673A") && /\d/.test(clean)) return true;
  const last4 = cleanPhone.slice(-4);
  if (last4 && (clean === `\u53F8\u673A${last4}` || clean.endsWith(last4))) return true;
  return false;
}
var _dbDirty = false;
var _dbWriteInFlight = false;
var _corruptQuarantineDone = false;
function readLocalJsonDb() {
  if (_dbDirty && cachedDbData) return cachedDbData;
  if (cachedDbData) return cachedDbData;
  try {
    if (import_fs.default.existsSync(LOCAL_JSON_DB_PATH)) {
      const content = import_fs.default.readFileSync(LOCAL_JSON_DB_PATH, "utf8");
      cachedDbData = JSON.parse(content || "{}");
      lastDbReadTime = Date.now();
      return cachedDbData;
    }
  } catch (e) {
    console.error("[Local JSON DB] Read error:", e);
    if (!_corruptQuarantineDone) {
      _corruptQuarantineDone = true;
      try {
        const q = `${LOCAL_JSON_DB_PATH}.corrupt.${Date.now()}`;
        import_fs.default.copyFileSync(LOCAL_JSON_DB_PATH, q);
        console.error(`[Local JSON DB] \u635F\u574F\u6587\u4EF6\u5DF2\u9694\u79BB\u5907\u4EFD: ${q}\uFF08\u8BF7\u4EBA\u5DE5\u6838\u67E5\u540E\u6062\u590D\u6216\u6E05\u7406\uFF09`);
      } catch (_) {
      }
    }
  }
  if (!cachedDbData) cachedDbData = {};
  return cachedDbData;
}
var _tmpWriteSeq = 0;
function uniqueTmpPath() {
  _tmpWriteSeq = (_tmpWriteSeq + 1) % 1e6;
  return `${LOCAL_JSON_DB_PATH}.tmp.${process.pid}.${Date.now()}.${_tmpWriteSeq}`;
}
function removeFileQuiet(p) {
  try {
    import_fs.default.unlinkSync(p);
  } catch (_) {
  }
}
function writeLocalJsonDb(data, immediate = true) {
  cachedDbData = data;
  lastDbReadTime = Date.now();
  if (immediate && !(isMySQLEnabled && mysqlPool)) {
    const tmpPath = uniqueTmpPath();
    try {
      import_fs.default.writeFileSync(tmpPath, JSON.stringify(data), "utf8");
      import_fs.default.renameSync(tmpPath, LOCAL_JSON_DB_PATH);
    } catch (e) {
      console.error("[Local JSON DB] Sync write error:", e?.message);
      removeFileQuiet(tmpPath);
      _dbDirty = true;
    }
    return;
  }
  _dbDirty = true;
}
var APPROVED_MEMBER_STATUS_VALUES = ["\u5DF2\u901A\u8FC7", "approved", "\u901A\u8FC7"];
function normalizeDriverPhoneUnified(value) {
  return String(value || "").replace(/\D/g, "").trim();
}
function parseStoredDoc(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return raw;
}
function parseStrictBool(value) {
  if (value === true || value === 1 || value === "true" || value === "1") return true;
  if (value === false || value === 0 || value === "false" || value === "0") return false;
  return void 0;
}
function hasMerchantASuffix(raw) {
  return /a$/i.test(String(raw ?? "").trim());
}
function isApprovedMemberStatus(value) {
  return APPROVED_MEMBER_STATUS_VALUES.includes(String(value || "").trim());
}
var PRESENCE_STATUS_TOKENS = /* @__PURE__ */ new Set(["idle", "busy", "offline", "online"]);
function effectiveMemberStatus(doc) {
  const st = String(doc?.status || "").trim();
  if (st && !PRESENCE_STATUS_TOKENS.has(st.toLowerCase())) return st;
  const ap = String(doc?.approvalStatus || "").trim();
  if (ap && !PRESENCE_STATUS_TOKENS.has(ap.toLowerCase())) return ap;
  return st || ap || "";
}
function squadPositionCodeFromRole(role) {
  const r = String(role || "");
  if (r.includes("\u5F00\u53D1\u8005")) return "developer";
  if (r.includes("\u57CE\u5E02\u8001\u677F") || r.includes("\u603B\u6307\u6325\u5B98")) return "boss";
  if (r.includes("\u57CE\u5E02\u7BA1\u7406")) return "manager";
  if (r.includes("\u57CE\u5E02\u6D3E\u5355\u5458")) return "dispatcher";
  return "normal";
}
function membershipLevelUnified(m) {
  const posCode = String(m?.squadPosition || "");
  const code = posCode === "developer" || posCode === "boss" || posCode === "manager" || posCode === "dispatcher" ? posCode : squadPositionCodeFromRole(m?.role || "");
  if (code === "developer") return 5;
  if (code === "boss") return 4;
  if (code === "manager") return 3;
  if (code === "dispatcher") return 2;
  return 0;
}
async function readCanonicalDocument(collection, docId) {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
        [collection, docId]
      );
      if (rows && rows.length > 0) return parseStoredDoc(rows[0].data);
    } catch (e) {
      console.error("[CanonicalRead] MySQL error:", collection, docId, e?.message);
    }
  }
  const dbData = readLocalJsonDb();
  return dbData[collection]?.[docId] ?? null;
}
async function readStatusDocument(collection, docId) {
  if (isMySQLEnabled && mysqlPool) {
    const [rows] = await mysqlPool.query(
      "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
      [collection, docId]
    );
    if (rows && rows.length > 0) return parseStoredDoc(rows[0].data);
    return null;
  }
  const dbData = readLocalJsonDb();
  return dbData[collection]?.[docId] ?? null;
}
var _removedSetCache5s = null;
async function getRemovedSetCached5s() {
  if (_removedSetCache5s && Date.now() - _removedSetCache5s.at < 5e3) return _removedSetCache5s.set;
  const arr = await readRemovedPhonesMergedUnified().catch(() => []);
  const set = new Set(arr.map((p) => normalizeDriverPhoneUnified(p)).filter(Boolean));
  _removedSetCache5s = { at: Date.now(), set };
  return set;
}
async function readRemovedPhonesMergedUnified() {
  const set = /* @__PURE__ */ new Set();
  const addAll = (list) => {
    if (Array.isArray(list)) list.forEach((p) => {
      const c = normalizeDriverPhoneUnified(p);
      if (c) set.add(c);
    });
  };
  try {
    addAll(readLocalJsonDb().config?.["removed_squad_members"]?.phones);
  } catch (_) {
  }
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
        ["config", "removed_squad_members"]
      );
      if (rows && rows.length > 0) addAll(parseStoredDoc(rows[0].data)?.phones);
    } catch (e) {
      console.error("[RemovedList] MySQL read error:", e?.message);
    }
  }
  return Array.from(set);
}
var _pendingDispatchCache = null;
var PENDING_DISPATCH_CACHE_TTL_MS = 1500;
var REPORTING_FRESH_MS = 45e3;
var orderLockChains = /* @__PURE__ */ new Map();
async function acquireOrderLock(orderId) {
  const key = String(orderId || "").trim();
  if (!key) return () => {
  };
  const prev = orderLockChains.get(key) || Promise.resolve();
  let releaseFn = () => {
  };
  const current = new Promise((resolve) => {
    releaseFn = resolve;
  });
  const chained = prev.then(() => current);
  orderLockChains.set(key, chained);
  chained.finally(() => {
    if (orderLockChains.get(key) === chained) orderLockChains.delete(key);
  });
  let timedOut = false;
  await Promise.race([
    prev,
    new Promise((resolve) => setTimeout(() => {
      timedOut = true;
      resolve();
    }, 6e4))
  ]);
  if (timedOut) console.warn(`[OrderLock] \u8BA2\u5355 ${key} \u7B49\u9501\u8D85\u65F660\u79D2\uFF0C\u6309\u5F02\u5E38\u653E\u884C`);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      releaseFn();
    }
  };
}
function orderLockMiddleware(req, res, next) {
  const orderId = String(req.body && (req.body.orderId || req.body.id) || "").trim();
  if (!orderId) return next();
  acquireOrderLock(orderId).then((release) => {
    res.on("finish", release);
    res.on("close", release);
    next();
  }).catch(() => next());
}
async function scanPendingDispatchMap() {
  const map = /* @__PURE__ */ new Map();
  const now = Date.now();
  const consider = (docId, o) => {
    if (!o) return;
    const phone = String(o.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
    if (!phone) return;
    const st = String(o.status || "").trim();
    if (st !== "dispatched" && st !== "submitted") return;
    if (String(o.claimedDriverPhone || "").trim()) return;
    if (o.in_hall === true || o.in_hall === "true") return;
    const expiresAt = Number(o.dispatchExpiresAt || 0) || (Number(o.dispatchedAt || 0) > 0 ? Number(o.dispatchedAt) + 6e4 : 0);
    if (!(expiresAt > now)) return;
    const prev = map.get(phone);
    if (!prev || expiresAt > prev.expiresAt) {
      map.set(phone, { orderId: String(docId || o.id || o.orderId || ""), expiresAt });
    }
  };
  let scannedFromMySQL = false;
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
        ["merchant_orders"]
      );
      (rows || []).forEach((r) => {
        try {
          consider(String(r.doc_id || ""), typeof r.data === "string" ? JSON.parse(r.data) : r.data);
        } catch (_) {
        }
      });
      scannedFromMySQL = true;
    } catch (_) {
    }
  }
  if (!scannedFromMySQL) {
    try {
      const mo = readLocalJsonDb()?.["merchant_orders"] || {};
      Object.keys(mo).forEach((k) => consider(k, mo[k]));
    } catch (_) {
    }
  }
  return map;
}
async function getPendingDispatchMap(fresh = false) {
  if (!fresh && _pendingDispatchCache && Date.now() - _pendingDispatchCache.at < PENDING_DISPATCH_CACHE_TTL_MS) {
    return _pendingDispatchCache.map;
  }
  const map = await scanPendingDispatchMap();
  _pendingDispatchCache = { at: Date.now(), map };
  return map;
}
async function getPendingDispatchForPhone(rawPhone, fresh = false) {
  const phone = String(rawPhone || "").replace(/\D/g, "").trim();
  if (!phone) return null;
  const map = await getPendingDispatchMap(fresh);
  return map.get(phone) || null;
}
var _activeClaimedCache = null;
function isTerminalOrderFact(o) {
  if (!o) return true;
  const st = String(o.status || "").trim();
  if (["completed", "\u5DF2\u5B8C\u6210", "cancelled", "\u5DF2\u53D6\u6D88", "true_cancelled", "true-cancelled", "hall", "expired"].includes(st)) return true;
  if (o.isCancelled === true || o.isCancelled === "true") return true;
  const cat = String(o.statusCategory || "");
  if (cat.includes("\u5DF2\u53D6\u6D88") || cat.includes("\u5DF2\u5B8C\u6210")) return true;
  return false;
}
async function loadMerchantOrdersCanonical() {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(
        "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
        ["merchant_orders"]
      );
      return (rows || []).map((r) => [String(r.doc_id || ""), typeof r.data === "string" ? parseStoredDoc(r.data) : r.data]);
    } catch (_) {
    }
  }
  try {
    const mo = readLocalJsonDb()?.["merchant_orders"] || {};
    return Object.keys(mo).map((k) => [k, mo[k]]);
  } catch (_) {
    return [];
  }
}
async function getActiveClaimedDriverSet() {
  if (_activeClaimedCache && Date.now() - _activeClaimedCache.at < PENDING_DISPATCH_CACHE_TTL_MS) {
    return _activeClaimedCache.set;
  }
  const set = /* @__PURE__ */ new Set();
  const consider = (o) => {
    if (!o) return;
    const claimed = String(o.claimedDriverPhone || "").replace(/\D/g, "").trim();
    if (!claimed) return;
    if (o.in_hall === true || o.in_hall === "true") return;
    if (isTerminalOrderFact(o)) return;
    set.add(claimed);
  };
  const docs = await loadMerchantOrdersCanonical();
  docs.forEach(([, o]) => consider(o));
  _activeClaimedCache = { at: Date.now(), set };
  return set;
}
async function findDriverActiveOrderId(phone, exceptOrderId) {
  const consider = (docId, o) => {
    if (!o) return null;
    const oid = String(docId || o.id || o.orderId || "");
    if (oid && oid === exceptOrderId) return null;
    const claimed = String(o.claimedDriverPhone || "").replace(/\D/g, "").trim();
    if (claimed !== phone) return null;
    if (o.in_hall === true || o.in_hall === "true") return null;
    if (isTerminalOrderFact(o)) return null;
    return oid || "unknown";
  };
  const docs = await loadMerchantOrdersCanonical();
  for (const [k, o] of docs) {
    const r = consider(k, o);
    if (r) return r;
  }
  return null;
}
function occupancyOf(phone, pendingMap, docLike) {
  if (pendingMap && phone && pendingMap.has(phone)) return { occupied: true, reason: "pending" };
  const rep = docLike?.isReporting === true || docLike?.isReporting === "true";
  const repAt = Number(docLike?.reportingAt || 0);
  if (rep && repAt > 0 && Date.now() - repAt < REPORTING_FRESH_MS) return { occupied: true, reason: "reporting" };
  return { occupied: false, reason: null };
}
async function getUnifiedMembership(rawPhone) {
  const phone = normalizeDriverPhoneUnified(rawPhone);
  const isDeveloper = phone === DEVELOPER_PHONE_SERVER;
  if (!phone) {
    return {
      phone,
      isDeveloper: false,
      isRemoved: false,
      isMember: false,
      phase: "none",
      memberStatus: "",
      applicationStatus: "",
      memberDoc: null,
      applicationDoc: null,
      driverDoc: null,
      role: "",
      squadPosition: "",
      licenseExpiry: "\u5F85\u5F00\u901A",
      vipExpiry: "\u5F85\u5F00\u901A",
      removedPhones: []
    };
  }
  const removedPhones = await readRemovedPhonesMergedUnified();
  const isRemoved = !isDeveloper && removedPhones.includes(phone);
  const memberDoc = await readStatusDocument("squad_members", phone);
  const applicationDoc = await readStatusDocument("squad_applications", phone);
  const driverDoc = await readCanonicalDocument("driver_users", phone);
  const memberStatus = effectiveMemberStatus(memberDoc);
  const isMember = isDeveloper || !isRemoved && !!memberDoc && isApprovedMemberStatus(memberStatus);
  const applicationStatus = effectiveMemberStatus(applicationDoc);
  let phase = "none";
  if (isMember) phase = "member";
  else if (["\u5F85\u5BA1\u6838", "pending", "\u5BA1\u6838\u4E2D"].includes(applicationStatus)) phase = "pending";
  else if (applicationStatus === "\u5DF2\u62D2\u7EDD") phase = "rejected";
  else if (isRemoved) phase = "removed";
  const pickLic = (v) => {
    const t = String(v ?? "").trim();
    return t && t !== "\u5F85\u5F00\u901A" ? t : "";
  };
  const licenseExpiry = pickLic(driverDoc?.licenseExpiry) || pickLic(memberDoc?.licenseExpiry) || "\u5F85\u5F00\u901A";
  const vipRaw = String(driverDoc?.vipExpiry ?? memberDoc?.vipExpiry ?? "").trim();
  return {
    phone,
    isDeveloper,
    isRemoved,
    isMember,
    phase,
    memberStatus,
    applicationStatus,
    memberDoc,
    applicationDoc,
    driverDoc,
    removedPhones,
    role: String(memberDoc?.role || memberDoc?.userRole || driverDoc?.role || driverDoc?.userRole || ""),
    squadPosition: String(memberDoc?.squad_position || ""),
    licenseExpiry,
    vipExpiry: vipRaw || "\u5F85\u5F00\u901A"
  };
}
function resolveExpiryFromDocs(memberDoc, driverDoc) {
  const pick = (v) => {
    const t = String(v ?? "").trim();
    return t && t !== "\u5F85\u5F00\u901A" ? t : "";
  };
  return {
    licenseExpiry: pick(memberDoc?.licenseExpiry) || pick(driverDoc?.licenseExpiry) || "\u5F85\u5F00\u901A",
    vipExpiry: pick(memberDoc?.vipExpiry) || pick(driverDoc?.vipExpiry) || "\u5F85\u5F00\u901A"
  };
}
async function readDriverExpiryUnified(rawPhone) {
  const phone = normalizeDriverPhoneUnified(rawPhone);
  if (!phone) return { licenseExpiry: "\u5F85\u5F00\u901A", vipExpiry: "\u5F85\u5F00\u901A" };
  const memberDoc = await readStatusDocument("squad_members", phone);
  const driverDoc = await readCanonicalDocument("driver_users", phone);
  return resolveExpiryFromDocs(memberDoc, driverDoc);
}
function syncLocalApprove(phone, memberPayload) {
  try {
    const db = readLocalJsonDb();
    if (!db.squad_members) db.squad_members = {};
    db.squad_members[phone] = memberPayload;
    if (!db.driver_users) db.driver_users = {};
    const ex = db.driver_users[phone] || {};
    db.driver_users[phone] = { ...ex, ...memberPayload, vipExpiry: ex.vipExpiry || memberPayload.vipExpiry };
    if (!db.team_members) db.team_members = {};
    db.team_members[phone] = { ...memberPayload, squad_position: squadPositionCodeFromRole(memberPayload.role), joinedAt: memberPayload.approvalTime };
    if (db.squad_applications) delete db.squad_applications[phone];
    if (db.driver_locations?.[phone]) db.driver_locations[phone] = { ...db.driver_locations[phone], isOnline: true };
    if (db.config?.["removed_squad_members"]?.phones) {
      db.config["removed_squad_members"] = {
        phones: db.config["removed_squad_members"].phones.map((p) => String(p).trim()).filter((p) => p && p !== phone),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    writeLocalJsonDb(db);
  } catch (_) {
  }
}
function syncLocalRemove(phone, driverPayload) {
  try {
    const db = readLocalJsonDb();
    if (db.squad_members) delete db.squad_members[phone];
    if (db.squad_applications) delete db.squad_applications[phone];
    if (db.team_members) delete db.team_members[phone];
    if (db.driver_locations?.[phone]) db.driver_locations[phone] = { ...db.driver_locations[phone], isOnline: false, isBusy: false };
    if (db.online_applications) delete db.online_applications[phone];
    if (db.passenger_links) delete db.passenger_links[phone];
    if (db.active_orders) delete db.active_orders[phone];
    if (!db.driver_users) db.driver_users = {};
    db.driver_users[phone] = driverPayload;
    if (!db.config) db.config = {};
    const cur = db.config["removed_squad_members"]?.phones || [];
    const phones = Array.from(/* @__PURE__ */ new Set([...cur.map((p) => String(p).trim()).filter(Boolean), phone]));
    db.config["removed_squad_members"] = { phones, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    writeLocalJsonDb(db);
  } catch (_) {
  }
}
function syncLocalReject(phone, mergedApp) {
  try {
    const db = readLocalJsonDb();
    if (!db.squad_applications) db.squad_applications = {};
    db.squad_applications[phone] = mergedApp;
    writeLocalJsonDb(db);
  } catch (_) {
  }
}
function syncLocalWithdraw(phone) {
  try {
    const db = readLocalJsonDb();
    if (db.squad_applications) delete db.squad_applications[phone];
    writeLocalJsonDb(db);
  } catch (_) {
  }
}
setInterval(() => {
  if (!_dbDirty || _dbWriteInFlight) return;
  _dbDirty = false;
  _dbWriteInFlight = true;
  const snapshot = cachedDbData;
  const tmpPath = uniqueTmpPath();
  import_fs.default.promises.writeFile(tmpPath, JSON.stringify(snapshot), "utf8").then(() => import_fs.default.promises.rename(tmpPath, LOCAL_JSON_DB_PATH)).catch((e) => {
    console.error("[Local JSON DB] Async write error:", e?.message);
    import_fs.default.promises.unlink(tmpPath).catch(() => {
    });
    _dbDirty = true;
  }).finally(() => {
    _dbWriteInFlight = false;
    if (cachedDbData !== snapshot) {
      _dbDirty = true;
    }
  });
}, 5e3);
try {
  if (import_fs.default.existsSync(LOCAL_JSON_DB_PATH)) {
    const bakPath = LOCAL_JSON_DB_PATH + ".bak";
    import_fs.default.copyFileSync(LOCAL_JSON_DB_PATH, bakPath);
    console.log("[Local JSON DB] \u542F\u52A8\u5907\u4EFD\u5DF2\u521B\u5EFA:", bakPath);
  }
} catch (e) {
  console.error("[Local JSON DB] \u542F\u52A8\u5907\u4EFD\u5931\u8D25:", e?.message);
}
try {
  const _tmpDir = import_path.default.dirname(LOCAL_JSON_DB_PATH);
  const _tmpBase = import_path.default.basename(LOCAL_JSON_DB_PATH);
  for (const _f of import_fs.default.readdirSync(_tmpDir)) {
    if (_f === _tmpBase + ".tmp" || _f.startsWith(_tmpBase + ".tmp.")) {
      removeFileQuiet(import_path.default.join(_tmpDir, _f));
    }
  }
} catch (_) {
}
async function runSystemDiskCleanup() {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const conn = await mysqlPool.getConnection();
      await conn.query("PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 1 DAY);");
      conn.release();
    } catch (_) {
    }
  }
  try {
    const logDirs = ["/www/wwwlogs/", "/var/log/nginx/"];
    for (const dir of logDirs) {
      if (import_fs.default.existsSync(dir)) {
        const files = await import_fs.default.promises.readdir(dir).catch(() => []);
        for (const file of files) {
          if (file.endsWith(".log")) {
            const filePath = import_path.default.join(dir, file);
            try {
              const stat = await import_fs.default.promises.stat(filePath).catch(() => null);
              if (stat && stat.size > 20 * 1024 * 1024) {
                await import_fs.default.promises.truncate(filePath, 0).catch(() => {
                });
              }
            } catch (_) {
            }
          }
        }
      }
    }
  } catch (_) {
  }
}
async function startServer() {
  await initDatabase();
  setInterval(() => {
    runSystemDiskCleanup().catch(() => {
    });
  }, 12 * 60 * 60 * 1e3);
  const GPS_OFFLINE_THRESHOLD_MS = 300 * 1e3;
  setInterval(() => {
    try {
      const dbData = readLocalJsonDb();
      const locs = dbData?.driver_locations;
      if (!locs || typeof locs !== "object") return;
      const now = Date.now();
      let kicked = 0;
      let changed = false;
      const kickedPhones = [];
      for (const k of Object.keys(locs)) {
        const item = locs[k];
        if (!item || item.isOnline !== true) continue;
        const t = docLatestTimeMs(item);
        if (now - t > GPS_OFFLINE_THRESHOLD_MS) {
          locs[k] = { ...item, isOnline: false, onlineOrdersEnabled: false, kickedOfflineAt: now, kickReason: "gps_timeout_300s" };
          kicked++;
          kickedPhones.push(k);
          changed = true;
        }
      }
      if (changed) {
        writeLocalJsonDb(dbData);
        if (kicked > 0) console.log(`[GPS\u770B\u95E8\u72D7] ${kicked} \u540D\u53F8\u673A300\u79D2\u65E0GPS\uFF0C\u5DF2\u5F3A\u5236\u4E0B\u7EBF`);
        if (isMySQLEnabled && mysqlPool && kickedPhones.length > 0) {
          const kickPatch = JSON.stringify({ isOnline: false, onlineOrdersEnabled: false, kickedOfflineAt: now, kickReason: "gps_timeout_300s" });
          for (const kp of kickedPhones) {
            mysqlPool.query(
              "UPDATE `daijia_documents` SET `data` = JSON_MERGE_PATCH(`data`, ?) WHERE `collection` = ? AND `doc_id` = ?",
              [kickPatch, "driver_locations", kp]
            ).catch(() => {
            });
          }
        }
      }
    } catch (e) {
      console.error("[GPS\u770B\u95E8\u72D7] \u626B\u63CF\u5F02\u5E38:", e?.message);
    }
  }, 30 * 1e3);
  const app = (0, import_express.default)();
  app.set("trust proxy", 1);
  function getClientIp(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || "").trim();
    if (/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip)) {
      return ip;
    }
    return "unknown";
  }
  const PORT = 3e3;
  app.use(import_express.default.json({ limit: "20mb" }));
  app.use(import_express.default.urlencoded({ extended: true, limit: "20mb" }));
  const CORS_WHITELIST = [
    "https://api.lyheiwandaijiamax.com",
    "https://admin.lyheiwandaijiamax.com",
    "https://lyheiwandaijiamax.com",
    "https://418000199ly-lgtm.github.io",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    // Capacitor 原生 App 的 Origin（iOS/Android）
    "capacitor://heiwan.daijia",
    "https://heiwan.daijia",
    "http://heiwan.daijia"
  ];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_WHITELIST.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else if (!origin) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token, X-Requested-With, Keep-Alive, User-Agent, Cache-Control, X-App-Version");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  app.use((req, res, next) => {
    const host = (req.headers.host || "").toLowerCase();
    const reqPath = req.path;
    if (req.query.api_mode === "pure" && !reqPath.startsWith("/api/") && reqPath !== "/privacy" && !reqPath.includes(".") && !reqPath.startsWith("/daijia_deploy") && !reqPath.startsWith("/baota_deploy") && !reqPath.startsWith("/deploy")) {
      return res.status(200).json({
        code: 200,
        status: "ONLINE",
        node: "Heiwan Daijia API Gateway",
        message: "\u{1F512} \u5B89\u5168\u7F51\u5173\u8282\u70B9\u6B63\u5E38\u8FD0\u884C\u4E2D\u3002",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    next();
  });
  const seedSuperAdminAccount = async () => {
    const superAdminData = {
      phone: "15509601222",
      role: "SUPER_DEVELOPER_ADMIN",
      name: "\u6700\u9AD8\u5F00\u53D1\u8005",
      status: "ACTIVE",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const now = /* @__PURE__ */ new Date();
    const target46Date = new Date(now.getTime() + 46 * 24 * 60 * 60 * 1e3);
    const yyyy = target46Date.getFullYear();
    const mm = String(target46Date.getMonth() + 1).padStart(2, "0");
    const dd = String(target46Date.getDate()).padStart(2, "0");
    const default46Expiry = `${yyyy}-${mm}-${dd}`;
    const driverUserData = {
      phone: "15509601222",
      driverName: "\u5434\u5F66\u7956",
      role: "\u5F00\u53D1\u8005",
      userRole: "\u5F00\u53D1\u8005",
      vipExpiry: default46Expiry,
      customAppName: "\u6EF4\u6EF4\u4EE3\u9A7E",
      isOnline: false,
      onlineOrdersEnabled: false,
      isBanned: false,
      city: "\u94F6\u5DDD\u5E02",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      const dbData = readLocalJsonDb();
      if (!dbData.system_admins) dbData.system_admins = {};
      dbData.system_admins["15509601222"] = superAdminData;
      if (!dbData.driver_users) dbData.driver_users = {};
      const existingDriver = dbData.driver_users["15509601222"] || {};
      dbData.driver_users["15509601222"] = {
        ...driverUserData,
        ...existingDriver,
        customAppName: existingDriver.customAppName || "\u6EF4\u6EF4\u4EE3\u9A7E",
        vipExpiry: existingDriver.vipExpiry !== void 0 ? existingDriver.vipExpiry : default46Expiry
      };
      writeLocalJsonDb(dbData);
      console.log("\u2713 [Database] Super Admin 15509601222 verified in local_db.json");
    } catch (e) {
      console.error("[Seed] Failed to seed super admin into local_db.json:", e);
    }
    if (isMySQLEnabled && mysqlPool) {
      try {
        const conn = await mysqlPool.getConnection();
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`)
           VALUES ('system_admins', '15509601222', ?)
           ON DUPLICATE KEY UPDATE \`data\` = ?`,
          [JSON.stringify(superAdminData), JSON.stringify(superAdminData)]
        );
        const localDriver = readLocalJsonDb()?.driver_users?.["15509601222"] || driverUserData;
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`)
           VALUES ('driver_users', '15509601222', ?)
           ON DUPLICATE KEY UPDATE \`data\` = JSON_MERGE_PATCH(\`data\`, ?)`,
          [JSON.stringify(localDriver), JSON.stringify({ role: "\u5F00\u53D1\u8005", userRole: "\u5F00\u53D1\u8005" })]
        );
        conn.release();
        console.log("\u2713 [Database] Super Admin 15509601222 verified in MySQL");
      } catch (e) {
        console.error("[Seed] Failed to seed super admin into MySQL:", e);
      }
    }
  };
  seedSuperAdminAccount();
  console.log("[Membership] startup consolidation disabled (unified state machine)");
  const SERVER_VERSION = "ba8e4e90";
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: Date.now(), version: SERVER_VERSION.startsWith("__") ? "dev" : SERVER_VERSION, hmac: true });
  });
  app.get("/api/tts", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    const text = String(req.query.text || "").trim();
    if (!text) {
      return res.status(400).send("Missing text parameter");
    }
    if (text.length > 200) {
      return res.status(400).send("Text too long");
    }
    try {
      const ttsIp = getClientIp(req);
      if (!global.__ttsLogs) global.__ttsLogs = /* @__PURE__ */ new Map();
      const ttsLogs = global.__ttsLogs;
      const tNow = Date.now();
      const tArr = (ttsLogs.get(ttsIp) || []).filter((t) => tNow - t < 6e4);
      if (tArr.length >= 60) {
        return res.status(429).send("Too many requests");
      }
      tArr.push(tNow);
      ttsLogs.set(ttsIp, tArr);
    } catch (_) {
    }
    const encodedText = encodeURIComponent(text);
    const ttsProviders = [
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=web`,
        referer: "https://fanyi.baidu.com/"
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=baidu`,
        referer: "https://fanyi.baidu.com/"
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=tsn`,
        referer: "https://fanyi.baidu.com/"
      }
    ];
    for (const item of ttsProviders) {
      try {
        const response = await fetch(item.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": item.referer
          }
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 300) {
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.send(buffer);
          }
        }
      } catch (err) {
      }
    }
    return res.status(502).send("TTS synthesis failed on all upstream providers");
  });
  const requireDbAuth = async (req, res, next) => {
    const token = req.headers["x-auth-token"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ success: false, error: "\u672A\u767B\u5F55\uFF1A\u7F3A\u5C11\u8BA4\u8BC1\u4EE4\u724C\uFF0C\u8BF7\u5148\u77ED\u4FE1\u9A8C\u8BC1\u767B\u5F55" });
    }
    let info = null;
    try {
      const persistent = await verifyPersistentToken(String(token));
      if (persistent) {
        info = { phone: persistent.phone, scope: persistent.scope, isMerchant: persistent.isMerchant, createdAt: 0 };
      }
    } catch (_) {
    }
    if (!info) {
      info = authTokens.get(String(token)) || null;
    }
    if (!info) {
      return res.status(401).json({ success: false, error: "\u767B\u5F55\u5DF2\u5931\u6548\uFF1A\u4EE4\u724C\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u77ED\u4FE1\u9A8C\u8BC1\u767B\u5F55" });
    }
    const devPhoneNorm = String(DEVELOPER_PHONE_SERVER || "").trim().toUpperCase();
    const infoPhoneNorm = String(info.phone || "").trim().toUpperCase();
    if (infoPhoneNorm === devPhoneNorm || infoPhoneNorm === devPhoneNorm + "A") {
      req.authPhone = info.phone;
      req.isAdmin = true;
      req.userRole = "developer";
      req.isManager = true;
      return next();
    }
    const appVersion = String(req.body?.appVersion || req.headers?.["x-app-version"] || "").trim();
    const isDbWrite = req.path.startsWith("/api/db/") && ["POST", "PUT", "DELETE", "PATCH"].includes(String(req.method || "").toUpperCase());
    if (isDbWrite && !appVersion.startsWith("V2")) {
      console.warn(`[V1Block] \u62D2\u7EDD V1.0 \u5199\u64CD\u4F5C: \u624B\u673A=${info.phone}, \u8DEF\u5F84=${req.path}, \u7248\u672C=${appVersion || "(\u65E0)"}`);
      return res.status(403).json({
        success: false,
        error: "\u8BF7\u5347\u7EA7\u5230 V2.0 \u7248\u672C\u540E\u4F7F\u7528",
        needUpgrade: true,
        minVersion: "V2.0"
      });
    }
    let userRole = "normal";
    try {
      const purePhone = infoPhoneNorm.replace(/A$/, "");
      const memberDoc = await readStatusDocument("squad_members", purePhone) || await readStatusDocument("squad_members", info.phone) || {};
      let roleEligible = isApprovedMemberStatus(effectiveMemberStatus(memberDoc));
      if (roleEligible && purePhone !== DEVELOPER_PHONE_SERVER) {
        try {
          const removedForRole = await readRemovedPhonesMergedUnified();
          if (removedForRole.includes(purePhone)) roleEligible = false;
        } catch (_) {
        }
      }
      const pos = roleEligible ? String(memberDoc.squad_position || "").trim().toLowerCase() : "";
      if (pos === "boss" || pos === "manager" || pos === "dispatcher") userRole = pos;
      if (userRole === "normal" && roleEligible) {
        const r = String(memberDoc.role || memberDoc.userRole || "");
        if (r.includes("\u57CE\u5E02\u8001\u677F")) userRole = "boss";
        else if (r.includes("\u57CE\u5E02\u7BA1\u7406")) userRole = "manager";
        else if (r.includes("\u57CE\u5E02\u6D3E\u5355\u5458")) userRole = "dispatcher";
      }
    } catch (_) {
    }
    req.userRole = userRole;
    req.isManager = userRole === "boss" || userRole === "manager";
    req.isDispatcher = userRole === "dispatcher";
    const normalizeId = (s) => String(s || "").trim().toUpperCase();
    const bodyDocId = normalizeId(req.body?.id || req.body?.docId || req.body?.data?.id || "");
    const queryDocId = normalizeId(req.query?.id || req.query?.docId || "");
    const targetId = bodyDocId || queryDocId;
    const colName = String(req.body?.col || req.body?.collection || req.query?.col || req.query?.collection || "").trim();
    const MERCHANT_OWN_COLS = ["merchant_users", "web_valet_qrs", "app_valet_qrs", "dispatch_qrs", "dispatch_qrs_web", "dispatch_qrcodes"];
    const isMerchantToken = /A$/.test(infoPhoneNorm);
    const deA = (s) => s.replace(/A$/, "");
    if (isMerchantToken && MERCHANT_OWN_COLS.includes(colName) && targetId && deA(targetId) === deA(infoPhoneNorm)) {
      req.authPhone = info.phone;
      req.isAdmin = false;
      return next();
    }
    const MEMBER_COLS = ["squad_members", "driver_users", "driver_locations", "squad_applications", "online_applications", "team_members"];
    if (colName === "hubble_authorized_drivers") {
      const isDev = infoPhoneNorm === devPhoneNorm || infoPhoneNorm === devPhoneNorm + "A";
      if (isDev) {
        req.authPhone = info.phone;
        req.isAdmin = true;
        return next();
      }
      const isWriteReq = ["POST", "PUT", "DELETE", "PATCH"].includes(String(req.method || "GET").toUpperCase());
      if (isWriteReq) {
        return res.status(403).json({ success: false, error: "\u4EC5\u5F00\u53D1\u8005\u53EF\u7BA1\u7406\u54C8\u52C3\u6743\u9650" });
      }
    }
    if (req.isManager && colName === "driver_locations" && ["/api/db/set", "/api/db/save", "/api/db/update", "/api/db/delete", "/api/db/add"].includes(req.path)) {
      const ownDigits = infoPhoneNorm.replace(/\D/g, "");
      const tgtDigits = targetId.replace(/\D/g, "");
      if (!targetId || tgtDigits !== ownDigits) {
        return res.status(403).json({ success: false, error: "\u5B9A\u4F4D\u6570\u636E\u53EA\u80FD\u7531\u53F8\u673A\u672C\u4EBA\u4FEE\u6539" });
      }
      req.authPhone = info.phone;
      req.isAdmin = false;
      return next();
    }
    const ORDER_COLS = ["merchant_orders", "valet_orders"];
    if (req.isManager && (MEMBER_COLS.includes(colName) || ORDER_COLS.includes(colName))) {
      req.authPhone = info.phone;
      req.isAdmin = false;
      return next();
    }
    if (req.isDispatcher && ORDER_COLS.includes(colName)) {
      req.authPhone = info.phone;
      req.isAdmin = false;
      return next();
    }
    if (req.isDispatcher && colName === "squad_applications") {
      req.authPhone = info.phone;
      req.isAdmin = false;
      return next();
    }
    const BUSINESS_PATHS = /* @__PURE__ */ new Set([
      "/api/dispatch/countdown",
      "/api/order/countdown",
      "/api/order/claim",
      "/api/order/driver-claim",
      "/api/order/cancel",
      "/api/order/complete",
      "/api/order/to-hall",
      "/api/order/true-cancel",
      "/api/order/progress",
      "/api/dispatch/nearest",
      "/api/dispatch/page-heartbeat",
      "/api/driver/location",
      "/api/driver/locations",
      "/api/driver/status",
      "/api/driver/offline",
      "/api/driver/name",
      "/api/db/get",
      "/api/db/list",
      "/api/geocode",
      "/api/geo/locate",
      "/api/auth/logout",
      // 2026-10-18修：收款码上传/删除/获取、入队申请，这些接口传 phone 不传 id，
      // 不加白名单会被 H9 的"无目标id批量操作"逻辑误杀 403
      "/api/upload-wechat-qr",
      "/api/delete-wechat-qr",
      "/api/get-wechat-qr",
      "/api/squad-apply",
      // 2026-10-18补：二维码通知、VIP兑换、小队成员列表，业务接口有自己的鉴权，
      // 不走通用 id 归属检查，避免订单号等非手机号 id 被误杀
      "/api/qr-notify-check",
      "/api/vip-code-check",
      "/api/vip-code-redeem",
      "/api/squad/members"
    ]);
    if (BUSINESS_PATHS.has(req.path)) {
      req.authPhone = info.phone;
      req.isAdmin = false;
      return next();
    }
    if (req.path.startsWith("/api/db/")) {
      if (!targetId) {
        const isAddWithGeneratedId = req.path === "/api/db/add" && !req.body?.data?.id;
        if (!isAddWithGeneratedId) {
          console.warn(`[Auth] \u62D2\u7EDD\u65E0\u76EE\u6807id\u7684\u6279\u91CF\u64CD\u4F5C: token\u624B\u673A=${info.phone}, \u8DEF\u5F84=${req.path}`);
          return res.status(403).json({ success: false, error: "\u8BE5\u64CD\u4F5C\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
        }
      }
    }
    if (targetId && targetId !== infoPhoneNorm) {
      console.warn(`[Auth] \u62D2\u7EDD\u8D8A\u6743\u5199\u5165: token\u624B\u673A=${info.phone}, \u76EE\u6807=${targetId}, \u8DEF\u5F84=${req.path}`);
      return res.status(403).json({ success: false, error: "\u65E0\u6743\u64CD\u4F5C\u4ED6\u4EBA\u6570\u636E" });
    }
    req.authPhone = info.phone;
    req.isAdmin = false;
    next();
  };
  app.post("/api/admin/check-permission", requireDbAuth, (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    const { phone } = req.body;
    const cleanPhone = String(phone || "").trim();
    if (cleanPhone === "15509601222") {
      return res.json({
        success: true,
        isSuperAdmin: true,
        phone: "15509601222",
        role: "SUPER_DEVELOPER_ADMIN",
        message: "\u6700\u9AD8\u5F00\u53D1\u8005\u7279\u6743\u8D26\u53F7(15509601222)\u6570\u636E\u5E93\u5339\u914D\u6210\u529F"
      });
    }
    return res.status(403).json({
      success: false,
      isSuperAdmin: false,
      error: "\u274C \u65E0\u6743\u9650\uFF1A\u975E\u6700\u9AD8\u5F00\u53D1\u8005\u8D26\u53F7(15509601222)\uFF0C\u62D2\u7EDD\u8BBF\u95EE\u6216\u767B\u5F55\u7BA1\u7406\u540E\u53F0\uFF01"
    });
  });
  app.post("/api/admin/purge-all-drivers", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    return res.status(410).json({
      success: false,
      error: "\u8BE5\u6E05\u7406\u63A5\u53E3\u5DF2\u7981\u7528\uFF1A\u8BF7\u8D70\u505C\u670D\u5907\u4EFD\u6E05\u6D17\u6D41\u7A0B"
    });
  });
  app.get("/api/db/get", requireDbAuth, async (req, res) => {
    try {
      const col = String(req.query.col || req.query.collection || "").trim();
      const docId = String(req.query.id || req.query.docId || "").trim();
      if (!col || !docId) {
        return res.status(400).json({ exists: false, error: "Missing col or id parameter" });
      }
      if (col === "_config") {
        return res.status(403).json({ exists: false, error: "\u7981\u6B62\u8BFB\u53D6\u7CFB\u7EDF\u914D\u7F6E" });
      }
      const isDevGet = (() => {
        const p = String(req.authPhone || "").trim().toUpperCase();
        return p === DEVELOPER_PHONE_SERVER || p === DEVELOPER_PHONE_SERVER + "A";
      })();
      if (col === "auth_tokens" || col === "vip_codes" && !isDevGet) {
        return res.status(403).json({ exists: false, error: "\u7981\u6B62\u8BFB\u53D6\u8BE5\u96C6\u5408" });
      }
      if (col === "config" && (docId === "tokenSecret" || docId.startsWith("_"))) {
        return res.status(403).json({ exists: false, error: "\u7981\u6B62\u8BFB\u53D6\u7CFB\u7EDF\u914D\u7F6E" });
      }
      const requesterPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      const isAdminUser = requesterPhone === DEVELOPER_PHONE_SERVER;
      const cleanPhone = docId.replace(/\D/g, "").trim();
      const sensitiveSingleCols = ["driver_users", "squad_members", "online_applications", "driver_locations"];
      if (sensitiveSingleCols.includes(col) && !isAdminUser) {
        if (docId !== requesterPhone && cleanPhone !== requesterPhone) {
          return res.status(403).json({ exists: false, error: "\u65E0\u6743\u8BFB\u53D6\u4ED6\u4EBA\u6863\u6848" });
        }
      }
      const foundData = await readCanonicalDocument(col, docId);
      if (foundData) {
        if (col === "passenger_links" && !isAdminUser && cleanPhone !== requesterPhone) {
          const pub = {};
          for (const f of ["driverStartLocation", "driverBrandName", "vipExpiry", "driverName", "customAppName", "phone", "updatedAt"]) {
            if (foundData[f] !== void 0) pub[f] = foundData[f];
          }
          return res.json({ exists: true, id: docId, data: pub });
        }
        if (["merchant_orders", "valet_orders"].includes(col) && !isAdminUser && !req.isManager) {
          const d = foundData;
          const parties = [d.dispatchedDriverPhone, d.claimedDriverPhone, d.reporterPhone, d.merchantPhone, d.orderPhone, d.passengerPhone, d.dispatchedByPhone, d.createdBy, d.driverPhone].map((v) => String(v || "").replace(/\D/g, "")).filter(Boolean);
          if (!parties.includes(requesterPhone)) {
            return res.status(403).json({ exists: false, error: "\u65E0\u6743\u8BFB\u53D6\u4ED6\u4EBA\u8BA2\u5355" });
          }
        }
        if (col === "driver_users" && cleanPhone === requesterPhone) {
          const appVersionHdr = String(req.headers?.["x-app-version"] || "").trim();
          if (appVersionHdr) {
            const { vipExpiry: _omitVip, ...restData } = foundData;
            return res.json({ exists: true, id: docId, data: restData });
          }
        }
        if (col === "driver_locations") {
          try {
            const tcMap = await getTodayOrderCounts();
            return res.json({ exists: true, id: docId, data: { ...foundData, todayOrders: tcMap.get(cleanPhone) || 0 } });
          } catch (_) {
          }
        }
        return res.json({ exists: true, id: docId, data: foundData });
      }
      if (col === "config" && docId === "city_configs") {
        const defaultConfigs = {
          configs: {
            "\u94F6\u5DDD": { online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true, squadNames: ["\u94F6\u5DDD\u4EE3\u9A7E\u5C0F\u961F"] },
            "\u94F6\u5DDD\u5E02": { online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true, squadNames: ["\u94F6\u5DDD\u4EE3\u9A7E\u5C0F\u961F"] }
          }
        };
        return res.json({ exists: true, id: docId, data: defaultConfigs });
      }
      if (col === "config" && docId === "master_switches") {
        return res.json({ exists: true, id: docId, data: { online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true } });
      }
      return res.json({ exists: false, id: docId, data: null });
    } catch (err) {
      console.error("[DB Proxy GET Exception]:", err);
      res.status(500).json({ exists: false, error: err.message });
    }
  });
  const handleDbList = async (req, res) => {
    try {
      const col = String(req.params.col || req.query.col || req.query.collection || "").trim();
      if (!col) {
        return res.status(400).json({ docs: [], error: "Missing col parameter" });
      }
      if (col === "_config" || col === "config") {
        return res.status(403).json({ docs: [], error: "\u7981\u6B62\u8BFB\u53D6\u7CFB\u7EDF\u914D\u7F6E" });
      }
      const isDevList = (() => {
        const p = String(req.authPhone || "").trim().toUpperCase();
        return p === DEVELOPER_PHONE_SERVER || p === DEVELOPER_PHONE_SERVER + "A";
      })();
      if (col === "auth_tokens" || col === "vip_codes" && !isDevList) {
        return res.status(403).json({ docs: [], error: "\u7981\u6B62\u8BFB\u53D6\u8BE5\u96C6\u5408" });
      }
      if (req.query.constraints) {
        try {
          const parsedConstraints = JSON.parse(String(req.query.constraints));
          if (Array.isArray(parsedConstraints) && parsedConstraints.length > 0) {
            return res.status(400).json({ docs: [], error: "constraints \u67E5\u8BE2\u7EA6\u675F\u6682\u4E0D\u652F\u6301" });
          }
        } catch (_) {
          return res.status(400).json({ docs: [], error: "constraints \u53C2\u6570\u65E0\u6548" });
        }
      }
      const requesterPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      const isAdmin = requesterPhone === "15509601222";
      if (!isAdmin && (col === "driver_users" || col === "squad_members" || col === "online_applications")) {
      }
      const limitNum = Math.min(Math.max(Number(req.query.limit) || 1e4, 1), 2e4);
      const sinceParam = String(req.query.since || "").trim();
      const sinceDate = sinceParam ? new Date(sinceParam) : null;
      const hasValidSince = sinceDate && !isNaN(sinceDate.getTime());
      const sensitiveCols = ["driver_users", "squad_members", "online_applications", "driver_locations", "passenger_links", "hubble_authorized_drivers"];
      const isSensitive = sensitiveCols.includes(col);
      let forcedDocId = null;
      if (isSensitive && !isAdmin) {
        if (!requesterPhone) {
          return res.status(403).json({ docs: [], error: "\u65E0\u6743\u6279\u91CF\u8BFB\u53D6" });
        }
        forcedDocId = requesterPhone;
      }
      const maskPhoneForList = (v) => {
        const digits = String(v || "").replace(/\D/g, "").trim();
        if (!digits) return String(v || "");
        if (digits.length < 7) return "****";
        return digits.slice(0, 3) + "****" + digits.slice(-4);
      };
      const QR_SLIM_FIELDS = ["wechatQrCode", "qrCode", "wechatClean", "alipayQrCode", "paymentQrCode", "driverQrCode", "qrcode_url"];
      const slimListQrFields = (doc) => {
        if (!doc || !["driver_users", "squad_members"].includes(col)) return;
        const docDigits = String(doc.id || "").replace(/\D/g, "").trim();
        if (requesterPhone && docDigits === requesterPhone) return;
        for (const f of QR_SLIM_FIELDS) {
          if (doc[f] !== void 0) delete doc[f];
          if (doc.data && doc.data[f] !== void 0) delete doc.data[f];
        }
      };
      const listStaff = isDevList || req.isAdmin === true || req.isManager === true || req.isDispatcher === true;
      const slimOrderDocForList = (doc) => {
        if (!isOrdersCol || !doc || isDevList) return;
        if (doc.merchantPaymentQrCode !== void 0) delete doc.merchantPaymentQrCode;
        const st = String(doc.status || "");
        const terminal = st === "completed" || st === "cancelled" || doc.isCompleted === true || doc.isCancelled === true;
        if (terminal && doc.data && doc.data.merchantPaymentQrCode !== void 0) delete doc.data.merchantPaymentQrCode;
      };
      const redactOrderPii = (doc) => {
        if (listStaff || !doc) return;
        const me = requesterPhone;
        const involved = [doc.merchantPhone, doc.dispatchedDriverPhone, doc.claimedDriverPhone, doc.reporterPhone, doc.driverPhone].map((x) => String(x || "").replace(/\D/g, "").trim());
        if (me && involved.includes(me)) return;
        for (const f of ["passengerPhone", "customerPhone", "contactPhone", "passengerTel", "passengerMobile"]) {
          if (doc[f]) doc[f] = maskPhoneForList(doc[f]);
          if (doc.data && doc.data[f]) doc.data[f] = maskPhoneForList(doc.data[f]);
        }
      };
      const dbData = readLocalJsonDb();
      const isDriverCol = ["driver_users", "squad_members", "online_applications", "squad_applications"].includes(col);
      const isOrdersCol = ["merchant_orders", "valet_orders", "orders"].includes(col);
      const removedArr = await readRemovedPhonesMergedUnified().catch(() => dbData.config?.["removed_squad_members"]?.phones || []);
      const clearedTimestamp = Number(dbData.config?.["merchant_orders_cleared"]?.clearedAt || 0);
      if (isOrdersCol && requesterPhone && requesterPhone !== "15509601222") {
        if (removedArr.includes(requesterPhone)) {
          return res.json({ docs: [], list: [], data: [] });
        }
      }
      let listWatermark = hasValidSince ? sinceParam : null;
      if (isMySQLEnabled && mysqlPool) {
        try {
          let rows;
          if (forcedDocId) {
            [rows] = await mysqlPool.query(
              "SELECT `doc_id`, `data`, `updated_at` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, forcedDocId]
            );
          } else if (hasValidSince) {
            const sinceOverlap = new Date(sinceDate.getTime() - 5e3);
            [rows] = await mysqlPool.query(
              "SELECT `doc_id`, `data`, `updated_at` FROM `daijia_documents` WHERE `collection` = ? AND `updated_at` > ? ORDER BY `updated_at` DESC LIMIT ?",
              [col, sinceOverlap, limitNum]
            );
          } else {
            [rows] = await mysqlPool.query(
              "SELECT `doc_id`, `data`, `updated_at` FROM `daijia_documents` WHERE `collection` = ? ORDER BY `updated_at` DESC LIMIT ?",
              [col, limitNum]
            );
          }
          for (const r of rows || []) {
            const u = r.updated_at ? new Date(r.updated_at) : null;
            if (u && !isNaN(u.getTime())) {
              const iso = u.toISOString();
              if (!listWatermark || iso > listWatermark) listWatermark = iso;
            }
          }
          const now = /* @__PURE__ */ new Date();
          const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          target50d.setDate(target50d.getDate() + 50);
          const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, "0")}-${String(target50d.getDate()).padStart(2, "0")}`;
          const docs2 = (rows || []).map((r) => {
            const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            const obj = typeof data === "object" && data !== null ? { ...data } : {};
            return { ...obj, id: r.doc_id, data: obj };
          }).filter((doc) => {
            const docIdStr = String(doc.id || "").trim();
            const phoneStr = String(doc.phone || docIdStr || "").trim();
            const cleanPhone = phoneStr.replace(/\D/g, "").trim();
            const hasASuffix = docIdStr.toUpperCase().endsWith("A") || phoneStr.toUpperCase().endsWith("A");
            if (col === "hubble_authorized_drivers" && doc._revoked) return false;
            if (col === "squad_applications") {
              if (hasASuffix || doc.isMerchant || doc.accountType === "merchant") return false;
              if (cleanPhone === "15509601222") return false;
              return true;
            }
            if (col === "online_applications") {
              if (cleanPhone === "15509601222") return true;
              if (hasASuffix || doc.isMerchant) return false;
              return true;
            }
            if (["merchant_accounts", "merchant_users"].includes(col)) {
              const docRole = String(doc?.role || doc?.userRole || "");
              const isMerchantByRole = (docRole.includes("\u5546\u6237") || docRole.includes("\u5546\u5BB6")) && !docRole.includes("\u53F8\u673A");
              if (!docIdStr.toUpperCase().endsWith("A") && !doc?.isMerchant && doc?.accountType !== "merchant" && !isMerchantByRole) return false;
              return true;
            }
            if (["squad_members", "driver_users"].includes(col)) {
              if (cleanPhone === "15509601222") return true;
              if (hasASuffix) return false;
              return true;
            }
            if (isOrdersCol && clearedTimestamp > 0) {
              const t = Number(doc.timestamp || doc.createdAt || doc.dispatchedAt || 0);
              if (t > 0 && t <= clearedTimestamp) return false;
            }
            if (isOrdersCol) redactOrderPii(doc);
            return true;
          });
          docs2.forEach(slimListQrFields);
          if (isOrdersCol) docs2.forEach(slimOrderDocForList);
          if (col === "driver_locations" && docs2.length) {
            try {
              const tcMap = await getTodayOrderCounts();
              docs2.forEach((d) => {
                const p = String(d?.phone || d?.id || "").replace(/\D/g, "").trim();
                if (p) {
                  const c = tcMap.get(p) || 0;
                  d.todayOrders = c;
                  if (d.data) d.data.todayOrders = c;
                }
              });
            } catch (_) {
            }
          }
          return res.json({ docs: docs2, list: docs2, data: docs2, watermark: listWatermark });
        } catch (mysqlErr) {
          console.error("[DB Proxy LIST MySQL Error]:", mysqlErr);
          return res.status(500).json({ docs: [], error: "MySQL \u67E5\u8BE2\u5931\u8D25: " + (mysqlErr?.message || "unknown") });
        }
      }
      const colData = dbData[col] || {};
      listWatermark = (/* @__PURE__ */ new Date()).toISOString();
      const sinceMsJ = hasValidSince && sinceDate ? sinceDate.getTime() : 0;
      const docs = Object.keys(colData).map((k) => {
        const itemData = colData[k];
        const obj = typeof itemData === "object" && itemData !== null ? { ...itemData } : {};
        return {
          ...obj,
          id: k,
          // 第六轮(P0-1)：键 k 必须压过内嵌 id
          data: obj
        };
      }).filter((doc) => {
        if (forcedDocId) {
          const docIdStr2 = String(doc.id || "").trim();
          if (docIdStr2 !== forcedDocId) return false;
        }
        if (hasValidSince) {
          const tsPulseJ = isOrdersCol && Number(doc.hallPulse || 0) > 0 ? (Number(doc.hallPulse) + 1) * 15e3 : 0;
          const tsJ = Math.max(Number(doc.updatedAt || doc.lastStatusUpdateTime || doc.locationTimestamp || doc.lastLocationTime || doc.createdAt || doc.timestamp || 0), tsPulseJ);
          if (!(tsJ > sinceMsJ - 5e3)) return false;
        }
        const docIdStr = String(doc.id || "").trim();
        const phoneStr = String(doc.phone || docIdStr || "").trim();
        const cleanPhone = phoneStr.replace(/\D/g, "").trim();
        const hasASuffix = docIdStr.toUpperCase().endsWith("A") || phoneStr.toUpperCase().endsWith("A");
        if (col === "squad_applications") {
          if (hasASuffix || doc.isMerchant || doc.accountType === "merchant") return false;
          if (cleanPhone === "15509601222") return false;
          return true;
        }
        if (col === "hubble_authorized_drivers" && doc._revoked) return false;
        if (col === "online_applications") {
          if (cleanPhone === "15509601222") return true;
          if (hasASuffix || doc.isMerchant) return false;
          return true;
        }
        if (["merchant_accounts", "merchant_users"].includes(col)) {
          const docRoleJ = String(doc?.role || doc?.userRole || "");
          const isMerchantByRoleJ = (docRoleJ.includes("\u5546\u6237") || docRoleJ.includes("\u5546\u5BB6")) && !docRoleJ.includes("\u53F8\u673A");
          if (!docIdStr.toUpperCase().endsWith("A") && !doc?.isMerchant && doc?.accountType !== "merchant" && !isMerchantByRoleJ) return false;
          return true;
        }
        if (["squad_members", "driver_users"].includes(col)) {
          if (cleanPhone === "15509601222") return true;
          if (hasASuffix) return false;
          return true;
        }
        if (isOrdersCol && clearedTimestamp > 0) {
          const t = Number(doc.timestamp || doc.createdAt || doc.dispatchedAt || 0);
          if (t > 0 && t <= clearedTimestamp) return false;
        }
        if (isOrdersCol) redactOrderPii(doc);
        return true;
      });
      docs.forEach(slimListQrFields);
      if (isOrdersCol) docs.forEach(slimOrderDocForList);
      if (col === "driver_locations" && docs.length) {
        try {
          const tcMap = await getTodayOrderCounts();
          docs.forEach((d) => {
            const p = String(d?.phone || d?.id || "").replace(/\D/g, "").trim();
            if (p) {
              const c = tcMap.get(p) || 0;
              d.todayOrders = c;
              if (d.data) d.data.todayOrders = c;
            }
          });
        } catch (_) {
        }
      }
      return res.json({ docs, list: docs, data: docs, watermark: listWatermark });
    } catch (err) {
      console.error("[DB Proxy LIST Exception]:", err);
      res.status(500).json({ docs: [], error: err.message });
    }
  };
  app.get("/api/db/list", requireDbAuth, handleDbList);
  app.get("/api/db/:col", requireDbAuth, (req, res, next) => {
    const col = req.params.col;
    if (["get", "set", "save", "update", "delete", "clear-collection", "add", "migrate-from-firestore"].includes(col)) {
      return next();
    }
    return handleDbList(req, res);
  });
  app.post(["/api/db/set", "/api/db/save"], requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || "").trim();
      const docId = String(req.body.id || req.body.docId || "").trim();
      const data = req.body.data;
      const merge = req.body.merge !== void 0 ? Boolean(req.body.merge) : true;
      if (!col || !docId || data === void 0) {
        return res.status(400).json({ success: false, error: "Missing col, id, or data" });
      }
      if (col === "driver_users" && data && data.deviationMitigation === true) {
        try {
          const targetPhone = docId.replace(/\D/g, "").trim();
          let vipExpiry = String(data.vipExpiry || "");
          if (!vipExpiry) {
            if (isMySQLEnabled && mysqlPool) {
              const [vrows] = await mysqlPool.query("SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1", ["driver_users", targetPhone]);
              if (vrows && vrows.length > 0) {
                const vd = typeof vrows[0].data === "string" ? JSON.parse(vrows[0].data) : vrows[0].data;
                vipExpiry = String(vd.vipExpiry || "");
              }
            } else {
              vipExpiry = String(readLocalJsonDb()?.driver_users?.[targetPhone]?.vipExpiry || "");
            }
          }
          if (targetPhone !== "15509601222" && !isVipActiveServer(vipExpiry)) {
            return res.status(403).json({ success: false, error: "\u7EA0\u504F\u529F\u80FD\u4E3AVIP\u4E13\u5C5E\uFF0C\u8BF7\u5148\u5F00\u901AVIP" });
          }
        } catch (e) {
          console.error("[DB Set] \u7EA0\u504FVIP\u6821\u9A8C\u5F02\u5E38:", e?.message);
          return res.status(503).json({ success: false, error: "\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
        }
      }
      if ((["squad_members", "squad_applications", "team_members"].includes(col) || col === "config" && docId === "removed_squad_members") && !req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u6210\u5458\u4E0E\u7533\u8BF7\u72B6\u6001\u53EA\u80FD\u901A\u8FC7\u4E13\u7528\u63A5\u53E3\u53D8\u66F4", code: "PROTECTED_COLLECTION" });
      }
      if (col === "driver_users" && !req.isAdmin) {
        const STATE_FIELDS = ["status", "approvalStatus", "role", "userRole", "squad_position", "position", "is_squad_member", "inSquad", "isBanned", "onlineOrdersEnabled"];
        for (const f of STATE_FIELDS) {
          if (data && typeof data === "object" && f in data) delete data[f];
        }
      }
      if (col === "merchant_orders" || col === "valet_orders" || col === "orders") {
        const ORDER_STATE_FIELDS = ["status", "statusCategory", "isCancelled", "in_hall", "claimedDriverPhone", "claimedDriverName", "dispatchedDriverPhone", "dispatchedDriverName", "hallAt", "declinedDriverPhones", "timeoutDriverPhones"];
        for (const f of ORDER_STATE_FIELDS) {
          if (data && typeof data === "object" && f in data) delete data[f];
        }
      }
      if (col === "squad_members" && !req.isAdmin && !req.isManager) {
        const SENSITIVE = ["status", "approvalStatus", "role", "squad_position", "userRole", "position"];
        for (const f of SENSITIVE) {
          if (data && typeof data === "object" && f in data) {
            console.warn(`[Auth] \u5265\u79BB\u654F\u611F\u5B57\u6BB5: token\u624B\u673A=${req.authPhone}, \u5B57\u6BB5=${f}`);
            delete data[f];
          }
        }
      }
      if (["driver_users", "squad_members", "online_applications", "squad_applications"].includes(col)) {
        for (const f of ["vipExpiry", "licenseExpiry"]) {
          if (data && typeof data === "object" && f in data) {
            console.warn(`[Auth] \u901A\u7528\u63A5\u53E3\u5199${f}\u5DF2\u5265\u79BB: token\u624B\u673A=${req.authPhone}, col=${col}`);
            delete data[f];
          }
        }
      }
      if (col === "online_applications" && !req.isAdmin && data && typeof data === "object") {
        for (const f of ["status", "approvalStatus"]) {
          if (f in data) {
            const stV = String(data[f] || "").trim();
            if (!["\u5F85\u5BA1\u6838", "\u5F85\u5BA1\u6279", "pending", "\u672A\u63D0\u4EA4", ""].includes(stV)) {
              console.warn(`[Auth] online_applications ${f} \u81EA\u5199\u5DF2\u5265\u79BB(set): token\u624B\u673A=${req.authPhone}, \u503C=${stV}`);
              delete data[f];
            }
          }
        }
      }
      if (col === "driver_locations" && data && typeof data === "object") {
        for (const [f, mn, mx] of [["lat", -90, 90], ["latitude", -90, 90], ["lng", -180, 180], ["longitude", -180, 180]]) {
          const v = data[f];
          if (v !== void 0 && !isValidCoordValue(v, mn, mx)) delete data[f];
        }
        const eLat = data.lat !== void 0 ? Number(data.lat) : data.latitude !== void 0 ? Number(data.latitude) : void 0;
        const eLng = data.lng !== void 0 ? Number(data.lng) : data.longitude !== void 0 ? Number(data.longitude) : void 0;
        if (eLat === 0 || eLng === 0) {
          delete data.lat;
          delete data.lng;
          delete data.latitude;
          delete data.longitude;
        }
        if (eLat !== void 0 && eLng !== void 0 && eLat !== 0 && eLng !== 0) data.gpsValid = true;
      }
      if (col === "squad_members" && data && typeof data === "object" && PRESENCE_STATUS_TOKENS.has(String(data.status || "").trim().toLowerCase())) {
        delete data.status;
      }
      if ((col === "driver_users" || col === "driver_locations") && data && typeof data === "object" && data.isOnline === true) {
        const writerDigits = normalizeDriverPhoneUnified(req.authPhone);
        if (writerDigits && writerDigits === normalizeDriverPhoneUnified(docId) && writerDigits !== DEVELOPER_PHONE_SERVER) {
          const removedSetW = await getRemovedSetCached5s();
          if (removedSetW.has(writerDigits)) data.isOnline = false;
        }
      }
      const isExplicitApproval = isApprovedMemberStatus(data?.status) || isApprovedMemberStatus(data?.approvalStatus);
      if (col === "squad_members" && docId !== "15509601222" && !isExplicitApproval) {
        let isRemovedDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["config", "removed_squad_members"]
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === "string" ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p) => String(p).trim()) : [];
              if (phones.includes(docId)) isRemovedDriver = true;
            }
          } catch (_) {
          }
        } else {
          const dbDataTmp = readLocalJsonDb();
          const phones = dbDataTmp.config?.["removed_squad_members"]?.phones || [];
          if (Array.isArray(phones) && phones.map((p) => String(p).trim()).includes(docId)) {
            isRemovedDriver = true;
          }
        }
        if (isRemovedDriver) {
          console.warn(`[DB Proxy SET] Dropping non-approved squad_members write for removed driver: ${docId}`);
          return res.status(409).json({ success: false, id: docId, dropped: true, code: "REMOVED_DRIVER", error: "\u8BE5\u53F8\u673A\u5DF2\u88AB\u79FB\u51FA\u5C0F\u961F\uFF0C\u8BF7\u5148\u901A\u8FC7\u5BA1\u6279\u63A5\u53E3\u6062\u590D\u6210\u5458\u8D44\u683C" });
        }
      }
      let finalData = data;
      const now = /* @__PURE__ */ new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, "0")}-${String(target50d.getDate()).padStart(2, "0")}`;
      if (isMySQLEnabled && mysqlPool) {
        try {
          if (merge) {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, docId]
            );
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
              finalData = { ...prev, ...data };
              if (col === "driver_users" || col === "squad_members" || col === "online_applications" || col === "squad_applications") {
                if (data.vipExpiry !== void 0) {
                  finalData.vipExpiry = data.vipExpiry;
                } else if (prev && prev.vipExpiry !== void 0) {
                  finalData.vipExpiry = prev.vipExpiry;
                } else if (!finalData.vipExpiry) {
                  finalData.vipExpiry = "\u5F85\u5F00\u901A";
                }
                if (data.customAppName !== void 0) {
                  finalData.customAppName = data.customAppName;
                } else if (prev.customAppName !== void 0) {
                  finalData.customAppName = prev.customAppName;
                }
                if (data.deviationMitigation !== void 0) {
                  finalData.deviationMitigation = Boolean(data.deviationMitigation);
                } else if (prev.deviationMitigation !== void 0) {
                  finalData.deviationMitigation = prev.deviationMitigation;
                }
                if (data.deviationKm !== void 0) {
                  finalData.deviationKm = data.deviationKm;
                } else if (prev.deviationKm !== void 0) {
                  finalData.deviationKm = prev.deviationKm;
                }
                if (data.deviationWaitSec !== void 0) {
                  finalData.deviationWaitSec = data.deviationWaitSec;
                } else if (prev.deviationWaitSec !== void 0) {
                  finalData.deviationWaitSec = prev.deviationWaitSec;
                }
              }
            }
          }
          const dataStr = JSON.stringify(finalData);
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            [col, docId, dataStr]
          );
        } catch (mysqlErr) {
          console.error("[DB Proxy SET MySQL Error]:", mysqlErr);
          return res.status(500).json({ success: false, error: "\u6570\u636E\u5E93\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
        }
      }
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      if (merge && dbData[col][docId] && !(isMySQLEnabled && mysqlPool)) {
        const prev = dbData[col][docId];
        finalData = { ...prev, ...data };
        if (col === "driver_users" || col === "squad_members" || col === "online_applications" || col === "squad_applications") {
          if (data.vipExpiry !== void 0) {
            finalData.vipExpiry = data.vipExpiry;
          } else if (prev && prev.vipExpiry !== void 0) {
            finalData.vipExpiry = prev.vipExpiry;
          } else if (!finalData.vipExpiry) {
            finalData.vipExpiry = "\u5F85\u5F00\u901A";
          }
          if (data.customAppName !== void 0) {
            finalData.customAppName = data.customAppName;
          } else if (prev.customAppName !== void 0) {
            finalData.customAppName = prev.customAppName;
          }
          if (data.deviationMitigation !== void 0) {
            finalData.deviationMitigation = Boolean(data.deviationMitigation);
          } else if (prev.deviationMitigation !== void 0) {
            finalData.deviationMitigation = prev.deviationMitigation;
          }
          if (data.deviationKm !== void 0) {
            finalData.deviationKm = data.deviationKm;
          } else if (prev.deviationKm !== void 0) {
            finalData.deviationKm = prev.deviationKm;
          }
          if (data.deviationWaitSec !== void 0) {
            finalData.deviationWaitSec = data.deviationWaitSec;
          } else if (prev.deviationWaitSec !== void 0) {
            finalData.deviationWaitSec = prev.deviationWaitSec;
          }
        }
      }
      dbData[col][docId] = finalData;
      if (col === "squad_members" || col === "online_applications" || col === "squad_applications") {
        const cleanDriverPhone = docId.replace(/\D/g, "").trim();
        if (cleanDriverPhone.length === 11) {
          if (!dbData["driver_users"]) dbData["driver_users"] = {};
          const existingUser = dbData["driver_users"][cleanDriverPhone] || {};
          const name = finalData.name || finalData.driverName || finalData.applicantName || existingUser.driverName || `\u53F8\u673A${cleanDriverPhone.slice(-4)}`;
          const resolvedVip = finalData.vipExpiry !== void 0 ? finalData.vipExpiry : existingUser.vipExpiry || "\u5F85\u5F00\u901A";
          const mergedDriverUser = {
            ...existingUser,
            ...finalData,
            phone: cleanDriverPhone,
            phoneNumber: cleanDriverPhone,
            driverName: name,
            name,
            role: finalData.role || finalData.userRole || existingUser.role || "\u666E\u901A\u53F8\u673A",
            userRole: finalData.role || finalData.userRole || existingUser.userRole || "\u666E\u901A\u53F8\u673A",
            status: finalData.status || existingUser.status || "\u672A\u52A0\u5165\u5C0F\u961F",
            is_squad_member: col === "squad_members" && isApprovedMemberStatus(effectiveMemberStatus(finalData)) ? 1 : existingUser.is_squad_member ?? 0,
            city: finalData.city || existingUser.city || "\u94F6\u5DDD\u5E02",
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== void 0 ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: existingUser.onlineOrdersEnabled === true,
            // 2026-10-22 第九轮(P1)：只保留既有审批结果，镜像不透传、不再默认置真（旧默认 true 让提交申请即自置开通）
            isBanned: Boolean(finalData.isBanned !== void 0 ? finalData.isBanned : existingUser.isBanned),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          dbData["driver_users"][cleanDriverPhone] = mergedDriverUser;
          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["driver_users", cleanDriverPhone, JSON.stringify(mergedDriverUser)]
            ).catch(() => {
            });
          }
        }
      }
      if (col === "driver_users") {
        const cleanDriverPhone = docId.replace(/\D/g, "").trim();
        if (cleanDriverPhone.length === 11) {
          const mirrorCols = ["squad_members", "squad_applications"];
          for (const mCol of mirrorCols) {
            let currentM = dbData[mCol] ? dbData[mCol][cleanDriverPhone] : void 0;
            if (isMySQLEnabled && mysqlPool) {
              try {
                const [mRows] = await mysqlPool.query(
                  "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                  [mCol, cleanDriverPhone]
                );
                if (mRows && mRows.length > 0) {
                  currentM = typeof mRows[0].data === "string" ? JSON.parse(mRows[0].data) : mRows[0].data;
                }
              } catch (_) {
              }
            }
            if (currentM) {
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== void 0) updatedM.vipExpiry = finalData.vipExpiry;
              if (finalData.wechatQrCode) updatedM.wechatQrCode = finalData.wechatQrCode;
              if (finalData.qrCode) updatedM.qrCode = finalData.qrCode;
              if (finalData.qrcode_url) updatedM.qrcode_url = finalData.qrcode_url;
              if (finalData.driverName) {
                updatedM.driverName = finalData.driverName;
                updatedM.name = finalData.driverName;
              }
              if (finalData.city) updatedM.city = finalData.city;
              if (finalData.isBanned !== void 0) updatedM.isBanned = finalData.isBanned;
              dbData[mCol][cleanDriverPhone] = updatedM;
              if (isMySQLEnabled && mysqlPool) {
                mysqlPool.query(
                  "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                  [mCol, cleanDriverPhone, JSON.stringify(updatedM)]
                ).catch(() => {
                });
              }
            }
          }
        }
      }
      writeLocalJsonDb(dbData, true);
      return res.json({ success: true, id: docId });
    } catch (err) {
      console.error("[DB Proxy SET Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/db/update", requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || "").trim();
      const docId = String(req.body.id || req.body.docId || "").trim();
      const data = req.body.data;
      if (!col || !docId || data === void 0) {
        return res.status(400).json({ success: false, error: "Missing col, id, or data" });
      }
      if ((["squad_members", "squad_applications", "team_members"].includes(col) || col === "config" && docId === "removed_squad_members") && !req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u6210\u5458\u4E0E\u7533\u8BF7\u72B6\u6001\u53EA\u80FD\u901A\u8FC7\u4E13\u7528\u63A5\u53E3\u53D8\u66F4", code: "PROTECTED_COLLECTION" });
      }
      if (col === "driver_users" && !req.isAdmin) {
        const STATE_FIELDS = ["status", "approvalStatus", "role", "userRole", "squad_position", "position", "is_squad_member", "inSquad", "isBanned", "onlineOrdersEnabled"];
        for (const f of STATE_FIELDS) {
          if (data && typeof data === "object" && f in data) delete data[f];
        }
      }
      if (col === "merchant_orders" || col === "valet_orders" || col === "orders") {
        const ORDER_STATE_FIELDS = ["status", "statusCategory", "isCancelled", "in_hall", "claimedDriverPhone", "claimedDriverName", "dispatchedDriverPhone", "dispatchedDriverName", "hallAt", "declinedDriverPhones", "timeoutDriverPhones"];
        for (const f of ORDER_STATE_FIELDS) {
          if (data && typeof data === "object" && f in data) delete data[f];
        }
      }
      if (col === "squad_members" && !req.isAdmin && !req.isManager) {
        const SENSITIVE = ["status", "approvalStatus", "role", "squad_position", "userRole", "position"];
        for (const f of SENSITIVE) {
          if (data && typeof data === "object" && f in data) {
            console.warn(`[Auth] \u5265\u79BB\u654F\u611F\u5B57\u6BB5: token\u624B\u673A=${req.authPhone}, \u5B57\u6BB5=${f}`);
            delete data[f];
          }
        }
      }
      if (["driver_users", "squad_members", "online_applications", "squad_applications"].includes(col)) {
        for (const f of ["vipExpiry", "licenseExpiry"]) {
          if (data && typeof data === "object" && f in data) {
            console.warn(`[Auth] \u901A\u7528\u63A5\u53E3\u5199${f}\u5DF2\u5265\u79BB: token\u624B\u673A=${req.authPhone}, col=${col}`);
            delete data[f];
          }
        }
      }
      if (col === "online_applications" && !req.isAdmin && data && typeof data === "object") {
        for (const f of ["status", "approvalStatus"]) {
          if (f in data) {
            const stV = String(data[f] || "").trim();
            if (!["\u5F85\u5BA1\u6838", "\u5F85\u5BA1\u6279", "pending", "\u672A\u63D0\u4EA4", ""].includes(stV)) {
              console.warn(`[Auth] online_applications ${f} \u81EA\u5199\u5DF2\u5265\u79BB(update): token\u624B\u673A=${req.authPhone}, \u503C=${stV}`);
              delete data[f];
            }
          }
        }
      }
      if (col === "driver_locations" && data && typeof data === "object") {
        for (const [f, mn, mx] of [["lat", -90, 90], ["latitude", -90, 90], ["lng", -180, 180], ["longitude", -180, 180]]) {
          const v = data[f];
          if (v !== void 0 && !isValidCoordValue(v, mn, mx)) delete data[f];
        }
        const eLat = data.lat !== void 0 ? Number(data.lat) : data.latitude !== void 0 ? Number(data.latitude) : void 0;
        const eLng = data.lng !== void 0 ? Number(data.lng) : data.longitude !== void 0 ? Number(data.longitude) : void 0;
        if (eLat === 0 || eLng === 0) {
          delete data.lat;
          delete data.lng;
          delete data.latitude;
          delete data.longitude;
        }
        if (eLat !== void 0 && eLng !== void 0 && eLat !== 0 && eLng !== 0) data.gpsValid = true;
      }
      if (col === "squad_members" && data && typeof data === "object" && PRESENCE_STATUS_TOKENS.has(String(data.status || "").trim().toLowerCase())) {
        delete data.status;
      }
      if ((col === "driver_users" || col === "driver_locations") && data && typeof data === "object" && data.isOnline === true) {
        const writerDigits = normalizeDriverPhoneUnified(req.authPhone);
        if (writerDigits && writerDigits === normalizeDriverPhoneUnified(docId) && writerDigits !== DEVELOPER_PHONE_SERVER) {
          const removedSetW = await getRemovedSetCached5s();
          if (removedSetW.has(writerDigits)) data.isOnline = false;
        }
      }
      const isExplicitApproval = isApprovedMemberStatus(data?.status) || isApprovedMemberStatus(data?.approvalStatus);
      if (col === "squad_members" && docId !== "15509601222" && !isExplicitApproval) {
        let isRemovedDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["config", "removed_squad_members"]
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === "string" ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p) => String(p).trim()) : [];
              if (phones.includes(docId)) isRemovedDriver = true;
            }
          } catch (_) {
          }
        } else {
          const dbDataTmp = readLocalJsonDb();
          const phones = dbDataTmp.config?.["removed_squad_members"]?.phones || [];
          if (Array.isArray(phones) && phones.map((p) => String(p).trim()).includes(docId)) {
            isRemovedDriver = true;
          }
        }
        if (isRemovedDriver) {
          console.warn(`[DB Proxy UPDATE] Dropping non-approved squad_members write for removed driver: ${docId}`);
          return res.status(409).json({ success: false, id: docId, dropped: true, code: "REMOVED_DRIVER", error: "\u8BE5\u53F8\u673A\u5DF2\u88AB\u79FB\u51FA\u5C0F\u961F\uFF0C\u8BF7\u5148\u901A\u8FC7\u5BA1\u6279\u63A5\u53E3\u6062\u590D\u6210\u5458\u8D44\u683C" });
        }
      }
      let finalData = data;
      if (isMySQLEnabled && mysqlPool) {
        const [rows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          [col, docId]
        );
        if (rows && rows.length > 0) {
          const prev = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
          finalData = { ...prev, ...data };
        }
        const dataStr = JSON.stringify(finalData);
        try {
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            [col, docId, dataStr]
          );
        } catch (mysqlErr) {
          console.error("[DB Proxy UPDATE MySQL Error]:", mysqlErr);
          return res.status(500).json({ success: false, error: "\u6570\u636E\u5E93\u5199\u5165\u5931\u8D25: " + (mysqlErr?.message || "MySQL error") });
        }
      }
      if (!(isMySQLEnabled && mysqlPool)) {
        const prevJsonDoc = readLocalJsonDb()?.[col]?.[docId];
        if (prevJsonDoc) finalData = { ...prevJsonDoc, ...data };
      }
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      dbData[col][docId] = finalData;
      if (col === "squad_members" || col === "online_applications" || col === "squad_applications") {
        const cleanDriverPhone = docId.replace(/\D/g, "").trim();
        if (cleanDriverPhone.length === 11) {
          if (!dbData["driver_users"]) dbData["driver_users"] = {};
          const existingUser = dbData["driver_users"][cleanDriverPhone] || {};
          const name = finalData.name || finalData.driverName || finalData.applicantName || existingUser.driverName || `\u53F8\u673A${cleanDriverPhone.slice(-4)}`;
          const resolvedVip = finalData.vipExpiry !== void 0 ? finalData.vipExpiry : existingUser.vipExpiry || "\u5F85\u5F00\u901A";
          const mergedDriverUser = {
            ...existingUser,
            ...finalData,
            phone: cleanDriverPhone,
            phoneNumber: cleanDriverPhone,
            driverName: name,
            name,
            role: finalData.role || finalData.userRole || existingUser.role || "\u666E\u901A\u53F8\u673A",
            userRole: finalData.role || finalData.userRole || existingUser.userRole || "\u666E\u901A\u53F8\u673A",
            status: finalData.status || existingUser.status || "\u672A\u52A0\u5165\u5C0F\u961F",
            is_squad_member: col === "squad_members" && isApprovedMemberStatus(effectiveMemberStatus(finalData)) ? 1 : existingUser.is_squad_member ?? 0,
            city: finalData.city || existingUser.city || "\u94F6\u5DDD\u5E02",
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== void 0 ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: existingUser.onlineOrdersEnabled === true,
            // 2026-10-22 第九轮(P1)：只保留既有审批结果，镜像不透传、不再默认置真（旧默认 true 让提交申请即自置开通）
            isBanned: Boolean(finalData.isBanned !== void 0 ? finalData.isBanned : existingUser.isBanned),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          dbData["driver_users"][cleanDriverPhone] = mergedDriverUser;
          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["driver_users", cleanDriverPhone, JSON.stringify(mergedDriverUser)]
            ).catch(() => {
            });
          }
        }
      }
      if (col === "driver_users") {
        const cleanDriverPhone = docId.replace(/\D/g, "").trim();
        if (cleanDriverPhone.length === 11) {
          const mirrorCols = ["squad_members", "squad_applications"];
          for (const mCol of mirrorCols) {
            let currentM = dbData[mCol] ? dbData[mCol][cleanDriverPhone] : void 0;
            if (isMySQLEnabled && mysqlPool) {
              try {
                const [mRows] = await mysqlPool.query(
                  "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                  [mCol, cleanDriverPhone]
                );
                if (mRows && mRows.length > 0) {
                  currentM = typeof mRows[0].data === "string" ? JSON.parse(mRows[0].data) : mRows[0].data;
                }
              } catch (_) {
              }
            }
            if (currentM) {
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== void 0) updatedM.vipExpiry = finalData.vipExpiry;
              if (finalData.driverName) {
                updatedM.driverName = finalData.driverName;
                updatedM.name = finalData.driverName;
              }
              if (finalData.city) updatedM.city = finalData.city;
              if (finalData.isBanned !== void 0) updatedM.isBanned = finalData.isBanned;
              dbData[mCol][cleanDriverPhone] = updatedM;
              if (isMySQLEnabled && mysqlPool) {
                mysqlPool.query(
                  "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                  [mCol, cleanDriverPhone, JSON.stringify(updatedM)]
                ).catch(() => {
                });
              }
            }
          }
        }
      }
      writeLocalJsonDb(dbData);
      return res.json({ success: true, id: docId });
    } catch (err) {
      console.error("[DB Proxy UPDATE Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/admin/update-driver-expiry", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const phone = String(req.body.phone || req.body.phoneNumber || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(req.body.phone) || hasMerchantASuffix(req.body.phoneNumber)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u80FD\u4FEE\u6539\u53F8\u673AVIP" });
      }
      const rawVip = String(req.body.vipExpiry || "").trim();
      if (req.body.vipExpiry === void 0 || rawVip === "") {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11 vipExpiry \u53C2\u6570" });
      }
      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: "\u8BF7\u8F93\u5165\u6709\u6548\u768411\u4F4D\u624B\u673A\u53F7\u7801" });
      }
      let vipExpiry = rawVip;
      if (!vipExpiry || vipExpiry === "0" || vipExpiry === "0\u5929" || vipExpiry === "\u5F85\u6FC0\u6D3B" || vipExpiry === "\u672A\u6FC0\u6D3B" || vipExpiry === "\u5F85\u5F00\u901A" || vipExpiry === "\u672A\u5F00\u901A" || vipExpiry === "\u5DF2\u5230\u671F" || vipExpiry === "\u5DF2\u8FC7\u671F") {
        vipExpiry = "\u5F85\u5F00\u901A";
      } else if (vipExpiry === "\u6C38\u4E45" || vipExpiry === "\u6C38\u4E45\u6709\u6548" || vipExpiry === "permanent" || vipExpiry === "\u7EC8\u8EAB") {
        vipExpiry = "\u6C38\u4E45\u6709\u6548";
      }
      if (vipExpiry !== "\u5F85\u5F00\u901A" && vipExpiry !== "\u6C38\u4E45\u6709\u6548") {
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vipExpiry);
        const dt = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : null;
        if (!dm || !dt || dt.getFullYear() !== Number(dm[1]) || dt.getMonth() !== Number(dm[2]) - 1 || dt.getDate() !== Number(dm[3])) {
          return res.status(400).json({ success: false, error: "vipExpiry \u683C\u5F0F\u65E0\u6548\uFF1A\u987B\u4E3A YYYY-MM-DD \u65E5\u671F\u3001\u6C38\u4E45\u6709\u6548\u6216\u5F85\u5F00\u901A" });
        }
      }
      const dbData = readLocalJsonDb();
      const targetCols = ["driver_users", "squad_members"];
      let expiryWroteAny = false;
      for (const col of targetCols) {
        const existing = await Promise.resolve(readCanonicalDocument(col, phone));
        if (!existing) continue;
        expiryWroteAny = true;
        if (!dbData[col]) dbData[col] = {};
        const updated = {
          ...existing,
          phone,
          phoneNumber: phone,
          vipExpiry,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        dbData[col][phone] = updated;
        if (isMySQLEnabled && mysqlPool) {
          const upsertSql = "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)";
          const upsertArgs = [col, phone, JSON.stringify(updated)];
          let mysqlOk = false;
          let lastMysqlErr = null;
          for (let attempt = 0; attempt < 3 && !mysqlOk; attempt++) {
            try {
              await mysqlPool.query(upsertSql, upsertArgs);
              mysqlOk = true;
            } catch (e) {
              lastMysqlErr = e;
              if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
            }
          }
          if (!mysqlOk) {
            console.error("[Admin VIP Expiry MySQL Write Failed]:", col, phone, lastMysqlErr?.message || lastMysqlErr);
            throw new Error(`MySQL \u5199\u5165\u5931\u8D25(${col})\uFF1A${lastMysqlErr?.message || lastMysqlErr}`);
          }
        }
      }
      if (!expiryWroteAny) {
        return res.status(404).json({ success: false, error: "\u8BE5\u53F8\u673A\u4E0D\u5B58\u5728" });
      }
      writeLocalJsonDb(dbData, true);
      console.log(`[Admin VIP Expiry Updated] Phone: ${phone} -> vipExpiry: ${vipExpiry}`);
      await logAdminOperation("update-vip-expiry", String(req.authPhone || ""), phone, `VIP\u6709\u6548\u671F\u8BBE\u4E3A${vipExpiry}`, req).catch(() => {
      });
      return res.json({ success: true, phone, vipExpiry });
    } catch (err) {
      console.error("[Admin VIP Expiry Update Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/admin/recharge-license", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u4EC5\u5F00\u53D1\u8005\u53EF\u5145\u503C\u63A5\u5355\u6388\u6743" });
    }
    try {
      const inputPhone = String(req.body.phone || req.body.phoneNumber || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(req.body.phone) || hasMerchantASuffix(req.body.phoneNumber)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u80FD\u5145\u503C\u63A5\u5355\u6388\u6743" });
      }
      const inputName = String(req.body.name || "").trim();
      const wantPermanent = req.body.permanent === true;
      const rawDays = req.body.days;
      const days = Math.floor(Number(rawDays));
      if (!wantPermanent) {
        if (rawDays === void 0 || rawDays === null || typeof rawDays === "boolean" || typeof rawDays === "object" || String(rawDays).trim() === "" || isNaN(days) || days < 0 || days > 3650) {
          return res.status(400).json({ success: false, error: "\u5929\u6570\u5FC5\u987B\u57280-3650\u4E4B\u95F4\uFF080=\u5C4F\u853D\u63A5\u5355\uFF09" });
        }
      }
      let targetPhone = inputPhone;
      if (!targetPhone && inputName) {
        const matches = [];
        const collectMatches = (pid, d) => {
          const n = String(d?.name || d?.driverName || "").trim();
          if (n && n === inputName) {
            const p = String(pid).replace(/\D/g, "").trim();
            if (/^1[3-9]\d{9}$/.test(p) && !matches.includes(p)) matches.push(p);
          }
        };
        if (isMySQLEnabled && mysqlPool) {
          const [rows] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? LIMIT 2000",
            ["squad_members"]
          );
          for (const r of rows || []) {
            try {
              const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              collectMatches(String(r.doc_id), d);
            } catch (_) {
            }
          }
        } else {
          const dbData = readLocalJsonDb();
          for (const [pid, d] of Object.entries(dbData.squad_members || {})) {
            collectMatches(pid, d);
          }
        }
        if (matches.length === 1) {
          targetPhone = matches[0];
        } else if (matches.length > 1) {
          return res.status(400).json({ success: false, error: `\u540D\u5B57"${inputName}"\u6709\u591A\u4EBA\u91CD\u540D\uFF0C\u8BF7\u7528\u624B\u673A\u53F7\u7CBE\u786E\u5145\u503C` });
        }
      }
      if (!targetPhone || !/^1[3-9]\d{9}$/.test(targetPhone)) {
        return res.status(400).json({ success: false, error: "\u672A\u627E\u5230\u8BE5\u53F8\u673A\uFF08\u8BF7\u68C0\u67E5\u624B\u673A\u53F7\u6216\u540D\u5B57\uFF09" });
      }
      const licGateDoc = await Promise.resolve(readCanonicalDocument("driver_users", targetPhone)) || await Promise.resolve(readCanonicalDocument("squad_members", targetPhone));
      if (!licGateDoc) {
        return res.status(404).json({ success: false, error: "\u672A\u627E\u5230\u8BE5\u53F8\u673A" });
      }
      const calcAbsoluteExpiry = () => {
        if (wantPermanent) return "\u6C38\u4E45\u6709\u6548";
        if (days === 0) return "\u5DF2\u5230\u671F";
        const base = /* @__PURE__ */ new Date();
        base.setDate(base.getDate() + days);
        return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
      };
      let newExpiry = "";
      const colExpiries = {};
      const targetCols = ["driver_users", "squad_members"];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (isMySQLEnabled && mysqlPool) {
        for (const col of targetCols) {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            [col, targetPhone]
          );
          if (!rows || rows.length === 0) continue;
          const existing = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
          const colExpiry = calcAbsoluteExpiry();
          colExpiries[col] = colExpiry;
          if (col === "driver_users") newExpiry = colExpiry;
          const updated = { ...existing, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiry, updatedAt: now };
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            [col, targetPhone, JSON.stringify(updated)]
          );
        }
        if (!newExpiry) newExpiry = colExpiries["squad_members"] || colExpiries["driver_users"] || "";
        try {
          const dbData = readLocalJsonDb();
          for (const col of targetCols) {
            if (!dbData[col] || !dbData[col][targetPhone]) continue;
            const existingLocal = dbData[col][targetPhone];
            dbData[col][targetPhone] = { ...existingLocal, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiries[col] || newExpiry, updatedAt: now };
          }
          writeLocalJsonDb(dbData);
        } catch (dualErr) {
          console.error("[Recharge License] \u672C\u5730JSON\u53CC\u5199\u5931\u8D25\uFF08MySQL\u5DF2\u6210\u529F\uFF09:", dualErr?.message);
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (!dbData[col] || !dbData[col][targetPhone]) continue;
          const existing = dbData[col][targetPhone];
          const colExpiryLocal = calcAbsoluteExpiry();
          if (col === "driver_users") newExpiry = colExpiryLocal;
          dbData[col][targetPhone] = { ...existing, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiryLocal, updatedAt: now };
        }
        if (!newExpiry) {
          const sqLic = dbData["squad_members"]?.[targetPhone]?.licenseExpiry;
          if (sqLic) newExpiry = String(sqLic);
        }
        writeLocalJsonDb(dbData);
      }
      const logDesc = wantPermanent ? "\u8BBE\u4E3A\u6C38\u4E45\u6709\u6548" : `\u8BBE\u4E3A${days}\u5929\uFF0C\u6709\u6548\u671F\u81F3${newExpiry}`;
      await logAdminOperation("recharge-license", String(req.authPhone || ""), targetPhone, logDesc, req);
      return res.json({ success: true, phone: targetPhone, licenseExpiry: newExpiry, daysAdded: wantPermanent ? -1 : days, permanent: wantPermanent });
    } catch (err) {
      console.error("[Recharge License Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/admin/batch-recharge-license", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u4EC5\u5F00\u53D1\u8005\u53EF\u6279\u91CF\u5145\u503C" });
    }
    try {
      const rawDays = req.body.days;
      const days = Math.floor(Number(rawDays));
      if (rawDays === void 0 || rawDays === null || typeof rawDays === "boolean" || typeof rawDays === "object" || String(rawDays).trim() === "" || isNaN(days) || days < 0 || days > 3650) {
        return res.status(400).json({ success: false, error: "\u5929\u6570\u5FC5\u987B\u57280-3650\u4E4B\u95F4\uFF080=\u5C4F\u853D\u63A5\u5355\uFF09" });
      }
      const calcExpiry = () => {
        if (days === 0) return "\u5DF2\u5230\u671F";
        const base = /* @__PURE__ */ new Date();
        base.setDate(base.getDate() + days);
        return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
      };
      const targetCols = ["driver_users", "squad_members"];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      let count = 0;
      const removedSetLicBatch = new Set(await readRemovedPhonesMergedUnified().catch(() => []));
      if (isMySQLEnabled && mysqlPool) {
        const [mrows] = await mysqlPool.query(
          "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
          ["squad_members"]
        );
        const dualWriteMap = {};
        for (const r of mrows || []) {
          const phone = String(r.doc_id).replace(/\D/g, "").trim();
          if (!/^1[3-9]\d{9}$/.test(phone)) continue;
          let curLic = "";
          try {
            const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            curLic = String(d.licenseExpiry || "");
            if (!isApprovedMemberStatus(effectiveMemberStatus(d))) continue;
            if (phone !== DEVELOPER_PHONE_SERVER && removedSetLicBatch.has(phone)) continue;
          } catch (_) {
            continue;
          }
          const newExp = days === 0 ? "\u5DF2\u5230\u671F" : calcExpiry();
          for (const col of targetCols) {
            const [erows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, phone]
            );
            if (!erows || erows.length === 0) continue;
            const ex = typeof erows[0].data === "string" ? JSON.parse(erows[0].data) : erows[0].data;
            const upd = { ...ex, phone, phoneNumber: phone, licenseExpiry: newExp, updatedAt: now };
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              [col, phone, JSON.stringify(upd)]
            );
          }
          dualWriteMap[phone] = newExp;
          count++;
        }
        try {
          const dbData = readLocalJsonDb();
          for (const [phone, newExp] of Object.entries(dualWriteMap)) {
            for (const col of targetCols) {
              if (!dbData[col] || !dbData[col][phone]) continue;
              const ex = dbData[col][phone];
              dbData[col][phone] = { ...ex, phone, phoneNumber: phone, licenseExpiry: newExp, updatedAt: now };
            }
          }
          writeLocalJsonDb(dbData);
        } catch (dualErr) {
          console.error("[Batch Recharge License] \u672C\u5730JSON\u53CC\u5199\u5931\u8D25\uFF08MySQL\u5DF2\u6210\u529F\uFF09:", dualErr?.message);
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const [phone, d] of Object.entries(dbData.squad_members || {})) {
          const p = String(phone).replace(/\D/g, "").trim();
          if (!/^1[3-9]\d{9}$/.test(p)) continue;
          if (!isApprovedMemberStatus(effectiveMemberStatus(d))) continue;
          if (p !== DEVELOPER_PHONE_SERVER && removedSetLicBatch.has(p)) continue;
          const newExp = days === 0 ? "\u5DF2\u5230\u671F" : calcExpiry();
          for (const col of targetCols) {
            if (!dbData[col] || !dbData[col][p]) continue;
            const ex = dbData[col][p];
            dbData[col][p] = { ...ex, phone: p, phoneNumber: p, licenseExpiry: newExp, updatedAt: now };
          }
          count++;
        }
        writeLocalJsonDb(dbData);
      }
      await logAdminOperation("batch-recharge-license", String(req.authPhone || ""), `${count}\u4EBA`, `\u6279\u91CF\u8BBE\u4E3A${days}\u5929\uFF0C\u5171${count}\u4EBA`, req).catch(() => {
      });
      return res.json({ success: true, count, daysAdded: days });
    } catch (err) {
      console.error("[Batch Recharge License Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/admin/update-driver-role", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const phone = String(req.body.phone || req.body.phoneNumber || "").replace(/\D/g, "").trim();
      const role = String(req.body.role || req.body.userRole || req.body.position || "").trim();
      const city = String(req.body.city || "").trim();
      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: "\u8BF7\u8F93\u5165\u6709\u6548\u768411\u4F4D\u624B\u673A\u53F7\u7801" });
      }
      const validRole = role || "\u666E\u901A\u53F8\u673A";
      const dbData = readLocalJsonDb();
      const targetCols = ["driver_users", "squad_members", "squad_applications", "online_applications"];
      const roleGateDoc = await Promise.resolve(readCanonicalDocument("driver_users", phone)) || await Promise.resolve(readCanonicalDocument("squad_members", phone));
      if (!roleGateDoc) {
        return res.status(404).json({ success: false, error: "\u8BE5\u53F8\u673A\u4E0D\u5B58\u5728" });
      }
      for (const col of targetCols) {
        const existing = await Promise.resolve(readCanonicalDocument(col, phone));
        if (!existing) continue;
        if (!dbData[col]) dbData[col] = {};
        const updated = {
          ...existing,
          phone,
          phoneNumber: phone,
          role: validRole,
          userRole: validRole,
          position: validRole,
          squad_position: validRole === "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A" ? "dispatcher" : validRole === "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A" ? "manager" : validRole === "\u57CE\u5E02\u8001\u677F\u53F8\u673A" ? "boss" : "normal",
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (city) updated.city = city;
        dbData[col][phone] = updated;
        if (isMySQLEnabled && mysqlPool) {
          const upsertSql2 = "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)";
          const upsertArgs2 = [col, phone, JSON.stringify(updated)];
          let mysqlOk2 = false;
          let lastMysqlErr2 = null;
          for (let attempt = 0; attempt < 3 && !mysqlOk2; attempt++) {
            try {
              await mysqlPool.query(upsertSql2, upsertArgs2);
              mysqlOk2 = true;
            } catch (e) {
              lastMysqlErr2 = e;
              if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
            }
          }
          if (!mysqlOk2) {
            console.error("[Admin Driver Role MySQL Write Failed]:", col, phone, lastMysqlErr2?.message || lastMysqlErr2);
            throw new Error(`MySQL \u5199\u5165\u5931\u8D25(${col})\uFF1A${lastMysqlErr2?.message || lastMysqlErr2}`);
          }
        }
      }
      if (!dbData.team_members) dbData.team_members = {};
      if (["\u5F00\u53D1\u8005\u53F8\u673A", "\u57CE\u5E02\u8001\u677F\u53F8\u673A", "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A", "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A"].includes(validRole)) {
        dbData.team_members[phone] = {
          ...dbData.team_members[phone] || {},
          phone,
          name: dbData.squad_members?.[phone]?.name || dbData.driver_users?.[phone]?.name || dbData.team_members[phone]?.name || "",
          role: validRole,
          squad_position: squadPositionCodeFromRole(validRole),
          status: "\u5DF2\u901A\u8FC7",
          city: city || dbData.driver_users?.[phone]?.city || "\u94F6\u5DDD\u5E02",
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["team_members", phone, JSON.stringify(dbData.team_members[phone])]
          ).catch(() => {
          });
        }
      } else {
        if (dbData.team_members[phone]) delete dbData.team_members[phone];
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["team_members", phone]
          ).catch(() => {
          });
        }
      }
      writeLocalJsonDb(dbData);
      console.log(`[Admin Driver Role Updated] Phone: ${phone} -> role: ${validRole}`);
      await logAdminOperation("update-driver-role", String(req.authPhone || ""), phone, `\u89D2\u8272\u8BBE\u4E3A${validRole}`, req).catch(() => {
      });
      return res.json({ success: true, phone, role: validRole });
    } catch (err) {
      console.error("[Admin Driver Role Update Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post(["/api/admin/batch-recharge-squad", "/api/admin/recharge-all-drivers"], requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const daysRaw = req.body?.days;
      const daysCount = daysRaw === void 0 || daysRaw === null || String(daysRaw).trim() === "" ? 50 : Math.floor(Number(daysRaw));
      if (isNaN(daysCount) || daysCount < 0 || daysCount > 3650) {
        return res.status(400).json({ success: false, error: "\u5929\u6570\u5FC5\u987B\u57280-3650\u4E4B\u95F4" });
      }
      const exclude = String(req.body.excludePhone || "15509601222").replace(/\D/g, "").trim();
      const now = /* @__PURE__ */ new Date();
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      targetDate.setDate(targetDate.getDate() + daysCount);
      const targetExpiry = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.squad_applications) dbData.squad_applications = {};
      if (!dbData.online_applications) dbData.online_applications = {};
      const allPhones = /* @__PURE__ */ new Set();
      ["squad_members", "squad_applications", "team_members", "driver_locations", "driver_users"].forEach((col) => {
        if (dbData[col]) {
          Object.keys(dbData[col]).forEach((k) => {
            const cleanPhone = String(dbData[col][k]?.phone || dbData[col][k]?.phoneNumber || k).replace(/\D/g, "").trim();
            if (cleanPhone && cleanPhone.length === 11 && cleanPhone !== exclude) {
              allPhones.add(cleanPhone);
            }
          });
        }
      });
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows] = await mysqlPool.query(
            "SELECT `collection`, `doc_id`, `data` FROM `daijia_documents` WHERE `collection` IN ('squad_members', 'online_applications', 'squad_applications', 'team_members', 'driver_locations', 'driver_users')"
          );
          if (Array.isArray(rows)) {
            rows.forEach((r) => {
              const cleanPhone = String(r.doc_id || "").replace(/\D/g, "").trim();
              if (cleanPhone && cleanPhone.length === 11 && cleanPhone !== exclude) {
                allPhones.add(cleanPhone);
              }
            });
          }
        } catch (_) {
        }
      }
      const updatedPhones = [];
      const failedPhones = [];
      const targetCols = ["driver_users", "squad_members"];
      const approvedPhones = /* @__PURE__ */ new Set();
      const skippedPhones = [];
      for (const phone of Array.from(allPhones)) {
        if (phone === exclude) continue;
        let mship = null;
        try {
          mship = await getUnifiedMembership(phone);
        } catch (_) {
        }
        if (mship && mship.isMember && !mship.isRemoved) {
          approvedPhones.add(phone);
        }
      }
      for (const phone of Array.from(approvedPhones)) {
        let recheck = null;
        try {
          recheck = await getUnifiedMembership(phone);
        } catch (_) {
        }
        if (!recheck || !recheck.isMember || recheck.isRemoved) {
          skippedPhones.push(phone);
          continue;
        }
        updatedPhones.push(phone);
        const sq = dbData.squad_members?.[phone] || {};
        const oa = dbData.online_applications?.[phone] || {};
        const sa = dbData.squad_applications?.[phone] || {};
        const du = dbData.driver_users?.[phone] || {};
        const name = du.driverName || du.name || sq.name || sq.driverName || oa.driverName || sa.name || `\u53F8\u673A${phone.slice(-4)}`;
        const city = du.city || sq.city || oa.city || "\u94F6\u5DDD\u5E02";
        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          let existing = dbData[col][phone] || {};
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [erows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                [col, phone]
              );
              if (erows && erows.length > 0) {
                existing = typeof erows[0].data === "string" ? JSON.parse(erows[0].data) : erows[0].data;
              }
            } catch (_) {
            }
          }
          const curVip = String(existing.vipExpiry || "").trim();
          let newVip;
          if (curVip === "\u6C38\u4E45\u6709\u6548" || curVip === "\u6C38\u4E45") {
            newVip = curVip;
          } else {
            let baseDate;
            try {
              const m = curVip.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
              if (m) {
                baseDate = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
                if (isNaN(baseDate.getTime()) || baseDate.getTime() < Date.now()) {
                  baseDate = /* @__PURE__ */ new Date();
                }
              } else {
                baseDate = /* @__PURE__ */ new Date();
              }
            } catch (_) {
              baseDate = /* @__PURE__ */ new Date();
            }
            baseDate.setDate(baseDate.getDate() + daysCount);
            newVip = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}-${String(baseDate.getDate()).padStart(2, "0")}`;
          }
          dbData[col][phone] = {
            ...existing,
            phone,
            phoneNumber: phone,
            name: existing.name || name,
            driverName: existing.driverName || name,
            city: existing.city || city,
            status: "\u5DF2\u901A\u8FC7",
            vipExpiry: newVip,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          if (isMySQLEnabled && mysqlPool) {
            try {
              await mysqlPool.query(
                "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                [col, phone, JSON.stringify(dbData[col][phone])]
              );
            } catch (e) {
              console.error(`[Batch VIP] MySQL\u5199\u5165\u5931\u8D25 ${col}/${phone}:`, e?.message);
              const failKey = `${phone}`;
              if (!failedPhones.includes(failKey)) failedPhones.push(failKey);
            }
          }
        }
      }
      writeLocalJsonDb(dbData);
      console.log(`\u2713 [Batch VIP Recharge] Successfully recharged ${updatedPhones.length} squad drivers with ${daysCount} days VIP`);
      try {
        await logAdminOperation("batch-recharge-vip", String(req.authPhone || ""), "squad", `\u6279\u91CFVIP\u5145\u503C\uFF0C\u5931\u8D25 ${failedPhones.length} \u4EBA`, req);
      } catch (_) {
      }
      return res.json({
        success: failedPhones.length === 0,
        count: updatedPhones.length,
        days: daysCount,
        targetExpiry,
        updatedPhones,
        skipped: skippedPhones.length,
        skippedPhones,
        // P1(2026-10-16第二遍审计)：返回失败名单，管理后台可见部分失败。
        failedPhones,
        failedCount: failedPhones.length
      });
    } catch (err) {
      console.error("[Batch VIP Recharge Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/db/delete", requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || "").trim();
      const docId = String(req.body.id || req.body.docId || "").trim();
      if (!col || !docId) {
        return res.status(400).json({ success: false, error: "Missing col or id" });
      }
      if (docId === "15509601222" && (col === "squad_members" || col === "driver_users" || col === "squad_applications")) {
        return res.status(403).json({ success: false, error: "\u5F00\u53D1\u8005 15509601222 \u62E5\u6709\u6700\u9AD8\u7CFB\u7EDF\u6743\u9650\uFF0C\u7981\u6B62\u5220\u9664\uFF01" });
      }
      if (["squad_members", "squad_applications", "team_members"].includes(col) && !req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u6210\u5458\u4E0E\u7533\u8BF7\u72B6\u6001\u53EA\u80FD\u901A\u8FC7\u4E13\u7528\u63A5\u53E3\u53D8\u66F4", code: "PROTECTED_COLLECTION" });
      }
      if (["driver_users", "online_applications"].includes(col) && !req.isAdmin) {
        const requesterPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
        const cleanDocPhone = docId.replace(/\D/g, "").trim();
        if (cleanDocPhone !== requesterPhone) {
          return res.status(403).json({ success: false, error: "\u5220\u9664\u4ED6\u4EBA\u6863\u6848\u8BF7\u8D70\u5C0F\u961F\u6210\u5458\u79FB\u9664\u6D41\u7A0B" });
        }
        if (req.body.hardDelete === true || req.body.hardDelete === "true") {
          return res.status(403).json({ success: false, error: "\u5F7B\u5E95\u5220\u9664\u8D26\u53F7\u8BF7\u8054\u7CFB\u5F00\u53D1\u8005\u5904\u7406" });
        }
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            [col, docId]
          );
          const isHardDelete = req.body.hardDelete === true || req.body.hardDelete === "true";
          if (col === "squad_members" && docId !== "15509601222") {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
              ["driver_locations", docId]
            );
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND (`doc_id` = ? OR JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.phone')) = ?)",
              ["squad_applications", docId, docId]
            );
            if (isHardDelete) {
              await mysqlPool.query(
                "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                ["driver_users", docId]
              );
              await mysqlPool.query(
                "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                ["online_applications", docId]
              );
            } else {
              const [uRows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                ["driver_users", docId]
              );
              let uData = { role: "\u666E\u901A\u53F8\u673A", userRole: "\u666E\u901A\u53F8\u673A", status: "\u672A\u52A0\u5165\u5C0F\u961F", approvalStatus: "\u672A\u52A0\u5165\u5C0F\u961F", is_squad_member: 0 };
              if (uRows && uRows.length > 0) {
                const prevU = typeof uRows[0].data === "string" ? JSON.parse(uRows[0].data) : uRows[0].data;
                uData = { ...prevU, ...uData, is_squad_member: 0, status: "\u672A\u52A0\u5165\u5C0F\u961F", approvalStatus: "\u672A\u52A0\u5165\u5C0F\u961F" };
              }
              await mysqlPool.query(
                "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                ["driver_users", docId, JSON.stringify(uData)]
              );
            }
            const [cfgRows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["config", "removed_squad_members"]
            );
            let cfgData = { phones: [docId] };
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === "string" ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones : [];
              if (!phones.includes(docId)) phones.push(docId);
              cfgData = { ...prevCfg, phones };
            }
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["config", "removed_squad_members", JSON.stringify(cfgData)]
            );
          } else if (col === "driver_users" && isHardDelete && docId !== "15509601222") {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
              ["squad_members", docId]
            );
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
              ["squad_applications", docId]
            );
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
              ["online_applications", docId]
            );
          }
        } catch (mysqlErr) {
          console.error("[DB Proxy DELETE MySQL Error]:", mysqlErr);
          return res.status(500).json({ success: false, error: "MySQL \u5220\u9664\u5931\u8D25: " + (mysqlErr?.message || "unknown") });
        }
      }
      const dbData = readLocalJsonDb();
      if (dbData[col] && dbData[col][docId] !== void 0) {
        delete dbData[col][docId];
      }
      if (col === "squad_members" && docId !== "15509601222") {
        if (dbData.driver_locations && dbData.driver_locations[docId]) {
          delete dbData.driver_locations[docId];
        }
        if (dbData.squad_applications) {
          for (const k of Object.keys(dbData.squad_applications)) {
            const app2 = dbData.squad_applications[k];
            if (k === docId || app2?.phone === docId || app2?.id === docId) {
              delete dbData.squad_applications[k];
            }
          }
        }
        if (dbData.driver_users && dbData.driver_users[docId]) {
          dbData.driver_users[docId] = {
            ...dbData.driver_users[docId],
            role: "\u666E\u901A\u53F8\u673A",
            userRole: "\u666E\u901A\u53F8\u673A",
            status: "\u672A\u52A0\u5165\u5C0F\u961F",
            approvalStatus: "\u672A\u52A0\u5165\u5C0F\u961F",
            is_squad_member: 0,
            inSquad: false,
            isSquadMember: false
          };
        }
        if (!dbData.config) dbData.config = {};
        if (!dbData.config["removed_squad_members"]) {
          dbData.config["removed_squad_members"] = { phones: [] };
        }
        const phones = dbData.config["removed_squad_members"].phones || [];
        if (!phones.includes(docId)) {
          phones.push(docId);
          dbData.config["removed_squad_members"].phones = phones;
        }
      }
      writeLocalJsonDb(dbData);
      return res.json({ success: true, id: docId });
    } catch (err) {
      console.error("[DB Proxy DELETE Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/db/clear-collection", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const col = String(req.body.col || req.body.collection || "").trim();
      if (!col) {
        return res.status(400).json({ success: false, error: "Missing col parameter" });
      }
      console.log(`[DB Proxy] Purging entire collection: ${col}`);
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ?",
            [col]
          );
          console.log(`\u2713 [MySQL] Cleared all records for collection: ${col}`);
        } catch (mysqlErr) {
          console.error("[DB Proxy CLEAR-COLLECTION MySQL Error]:", mysqlErr);
          return res.status(500).json({ success: false, error: "MySQL \u6E05\u8868\u5931\u8D25: " + (mysqlErr?.message || "unknown") });
        }
      }
      const dbData = readLocalJsonDb();
      if (dbData[col]) {
        dbData[col] = {};
      }
      if (col === "merchant_orders" || col === "valet_orders" || col === "orders") {
        const nowTs = Date.now();
        if (!dbData.config) dbData.config = {};
        dbData.config["merchant_orders_cleared"] = { clearedAt: nowTs };
        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["config", "merchant_orders_cleared", JSON.stringify({ clearedAt: nowTs })]
            );
          } catch (_) {
          }
        }
      }
      writeLocalJsonDb(dbData);
      try {
        await logAdminOperation("clear-collection", String(req.authPhone || ""), col, `\u6574\u8868\u6E05\u7A7A\u96C6\u5408 ${col}`, req);
      } catch (_) {
      }
      return res.json({ success: true, collection: col });
    } catch (err) {
      console.error("[DB Proxy CLEAR-COLLECTION Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/orders/clear-all", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      console.log("[DB Proxy] \u6B63\u5728\u6267\u884C\u5168\u91CF\u4E00\u952E\u6E05\u7A7A\uFF1A\u6E05\u9664\u6240\u6709\u8BA2\u5355\u8BB0\u5F55 (merchant_orders, valet_orders, orders, passenger_links, active_orders)");
      const nowTs = Date.now();
      const orderCollections = ["merchant_orders", "valet_orders", "orders", "passenger_links", "active_orders"];
      let mysqlClearFailed = false;
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?, ?, ?, ?)",
            orderCollections
          );
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["config", "merchant_orders_cleared", JSON.stringify({ clearedAt: nowTs })]
          );
          console.log("\u2713 [MySQL] \u5DF2\u5F7B\u5E95\u6E05\u9664\u6240\u6709\u8BA2\u5355\u6570\u636E\u8BB0\u5F55\u4E0E\u5386\u53F2\u7F13\u5B58");
        } catch (mysqlErr) {
          mysqlClearFailed = true;
          console.error("[MySQL Clear-All Orders Error]:", mysqlErr);
        }
        try {
          for (const busyCol of ["driver_users", "driver_locations"]) {
            const [bRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              [busyCol]
            );
            for (const bRow of bRows || []) {
              try {
                const bData = typeof bRow.data === "string" ? JSON.parse(bRow.data) : bRow.data;
                if (bData && bData.isBusy) {
                  bData.isBusy = false;
                  await mysqlPool.query(
                    "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
                    [JSON.stringify(bData), busyCol, bRow.doc_id]
                  );
                }
              } catch (_) {
              }
            }
          }
        } catch (_) {
        }
      }
      const dbData = readLocalJsonDb();
      orderCollections.forEach((c) => {
        dbData[c] = {};
      });
      if (!dbData.config) dbData.config = {};
      dbData.config["merchant_orders_cleared"] = { clearedAt: nowTs };
      if (dbData["driver_users"]) {
        Object.keys(dbData["driver_users"]).forEach((p) => {
          if (dbData["driver_users"][p]) {
            dbData["driver_users"][p].isBusy = false;
          }
        });
      }
      if (dbData["driver_locations"]) {
        Object.keys(dbData["driver_locations"]).forEach((p) => {
          if (dbData["driver_locations"][p]) {
            dbData["driver_locations"][p].isBusy = false;
          }
        });
      }
      writeLocalJsonDb(dbData);
      console.log("\u2713 [\u963F\u91CC\u4E91\u672C\u5730\u6570\u636E\u5E93] \u5DF2\u5F7B\u5E95\u6E05\u9664\u6240\u6709\u8BA2\u5355\u8BB0\u5F55\uFF0C\u672C\u5730\u4E0E\u670D\u52A1\u5668\u4E0D\u518D\u4FDD\u5B58\u6240\u6709\u8BA2\u5355\u8BB0\u5F55");
      try {
        await logAdminOperation("clear-all-orders", String(req.authPhone || ""), "merchant_orders", "\u4E00\u952E\u6E05\u7A7A\u5168\u90E8\u8BA2\u5355\u8BB0\u5F55", req);
      } catch (_) {
      }
      if (mysqlClearFailed) {
        return res.status(500).json({ success: false, clearedAt: nowTs, error: "MySQL \u8BA2\u5355\u8868\u5220\u9664\u5931\u8D25\uFF1A\u672C\u5730\u955C\u50CF\u5DF2\u6E05\u7A7A\u3001\u65F6\u95F4\u6233\u515C\u5E95\u5DF2\u751F\u6548\uFF08\u65E7\u5355\u4E0D\u4F1A\u518D\u663E\u793A\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6E05\u7A7A\u6216\u68C0\u67E5\u6570\u636E\u5E93" });
      }
      return res.json({ success: true, clearedAt: nowTs, message: "\u6240\u6709\u8BA2\u5355\u8BB0\u5F55\u5DF2\u4ECE\u670D\u52A1\u5668\u5F7B\u5E95\u6E05\u9664\uFF01" });
    } catch (err) {
      console.error("[Clear-All Orders Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  const performServerOffline = async (phone, reason) => {
    const cleanPhone = String(phone || "").trim();
    if (!cleanPhone) return;
    const offlinePayload = {
      isOnline: false,
      onlineOrdersEnabled: false,
      pending0559Offline: false,
      lastOfflineReason: reason,
      lastOfflineTime: (/* @__PURE__ */ new Date()).toISOString(),
      // 2026-11-26 下线残绿根治：记下线毫秒时间戳，供 /api/driver/location
      // 的 15 秒防翻转兜底判断（下线后迟到的周期性上报不得复活在线）。
      lastOfflineAt: Date.now(),
      lastUpdatedTime: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (isMySQLEnabled && mysqlPool) {
      try {
        for (const col of ["driver_users", "squad_members", "driver_locations"]) {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            [col, cleanPhone]
          );
          if (col === "squad_members" && !(rows && rows.length > 0)) continue;
          let merged = offlinePayload;
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
            merged = { ...prev, ...offlinePayload };
          }
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            [col, cleanPhone, JSON.stringify(merged)]
          );
        }
      } catch (err) {
        console.error("[MySQL performServerOffline Error]:", err);
      }
    }
    const dbData = readLocalJsonDb();
    ["driver_users", "squad_members", "driver_locations"].forEach((col) => {
      if (!dbData[col]) dbData[col] = {};
      if (col === "squad_members" && !dbData[col][cleanPhone]) return;
      const prev = dbData[col][cleanPhone] || {};
      dbData[col][cleanPhone] = { ...prev, ...offlinePayload };
    });
    writeLocalJsonDb(dbData, false);
  };
  app.post("/api/driver/offline", requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.driverPhone || "").trim();
      const reason = String(req.body.reason || "manual_offline").trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: "Missing driver phone" });
      }
      if (!req.isAdmin && phone.toUpperCase() !== String(req.authPhone || "").trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: "\u65E0\u6743\u64CD\u4F5C\u4ED6\u4EBA\u6570\u636E" });
      }
      await performServerOffline(phone, reason);
      console.log(`[Baota API /api/driver/offline] Driver ${phone} set to offline successfully (Reason: ${reason})`);
      return res.json({ success: true, phone, isOnline: false });
    } catch (err) {
      console.error("[Baota API /api/driver/offline Error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/driver/status", requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.driverPhone || "").trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: "Missing driver phone" });
      }
      if (!req.isAdmin && phone.toUpperCase() !== String(req.authPhone || "").trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: "\u65E0\u6743\u64CD\u4F5C\u4ED6\u4EBA\u6570\u636E" });
      }
      const isBusy = parseStrictBool(req.body.isBusy) === true;
      const status = isBusy ? "busy" : "idle";
      const currentView = req.body.currentView || (isBusy ? "create_order" : "home");
      const timestamp = req.body.timestamp || Date.now();
      const patch = {
        currentView,
        lastStatusUpdateTime: timestamp,
        lastUpdatedTime: (/* @__PURE__ */ new Date()).toISOString()
      };
      if (req.body.isBusy !== void 0) {
        patch.isBusy = isBusy;
      }
      if (req.body.isReporting !== void 0) {
        const isReporting = parseStrictBool(req.body.isReporting) === true;
        patch.isReporting = isReporting;
        patch.reportingAt = isReporting ? Date.now() : 0;
      }
      const dbData = readLocalJsonDb();
      ["driver_users", "driver_locations"].forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      writeLocalJsonDb(dbData);
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)",
            ["driver_locations", phone, JSON.stringify({ ...dbData.driver_locations?.[phone] || {}, ...patch, phone }), JSON.stringify({ ...patch, phone })]
          );
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)",
            ["driver_users", phone, JSON.stringify({ ...dbData.driver_users?.[phone] || {}, ...patch, phone }), JSON.stringify({ ...patch, phone })]
          );
        } catch (_) {
        }
      }
      return res.json({ success: true, phone, isBusy, status });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  function isValidCoordValue(v, min, max) {
    if (typeof v !== "number" && typeof v !== "string") return false;
    if (typeof v === "string" && v.trim() === "") return false;
    const n = Number(v);
    return isFinite(n) && n >= min && n <= max;
  }
  app.post("/api/driver/location", requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || "").trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: "Missing phone" });
      }
      if (!req.isAdmin && phone.toUpperCase() !== String(req.authPhone || "").trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: "\u65E0\u6743\u64CD\u4F5C\u4ED6\u4EBA\u6570\u636E" });
      }
      let lat = void 0;
      let lng = void 0;
      let coordsIgnored = false;
      const rawLat = req.body.lat !== void 0 ? req.body.lat : req.body.latitude;
      const rawLng = req.body.lng !== void 0 ? req.body.lng : req.body.longitude;
      if (rawLat !== void 0 || rawLng !== void 0) {
        if (isValidCoordValue(rawLat, -90, 90) && isValidCoordValue(rawLng, -180, 180) && Number(rawLat) !== 0 && Number(rawLng) !== 0) {
          lat = Number(rawLat);
          lng = Number(rawLng);
        } else {
          coordsIgnored = true;
        }
      }
      const isOnline = parseStrictBool(req.body.isOnline);
      const isBusy = parseStrictBool(req.body.isBusy);
      const todayOrders = req.body.todayOrders !== void 0 ? Number(req.body.todayOrders) : void 0;
      let timestamp = req.body.timestamp ? Number(req.body.timestamp) : Date.now();
      if (!isNaN(timestamp) && timestamp > Date.now() + 6e4) {
        return res.status(400).json({ success: false, error: "\u65F6\u95F4\u6233\u65E0\u6548\uFF1A\u4E0D\u80FD\u662F\u672A\u6765\u65F6\u95F4" });
      }
      if (isNaN(timestamp) || timestamp <= 0) timestamp = Date.now();
      const driverName = req.body.driverName || req.body.name;
      const patch = {
        lastUpdatedTime: (/* @__PURE__ */ new Date()).toISOString(),
        locationTimestamp: timestamp,
        isBusy
      };
      if (isBusy === void 0) delete patch.isBusy;
      let nameForPatch = "";
      if (driverName && !isGenericDriverName(driverName, phone)) nameForPatch = String(driverName).trim();
      try {
        const authName = await getAuthoritativeDriverName(phone);
        if (authName) nameForPatch = authName;
      } catch (_) {
      }
      if (nameForPatch) {
        patch.driverName = nameForPatch;
        patch.name = nameForPatch;
      }
      if (req.body.city) patch.city = req.body.city;
      if (req.body.version) patch.version = req.body.version;
      if (req.body.appVersion) patch.appVersion = req.body.appVersion;
      if (typeof req.body.currentView === "string") patch.currentView = req.body.currentView;
      if (req.body.isInReportView !== void 0) patch.isInReportView = parseStrictBool(req.body.isInReportView);
      if (typeof req.body.lastUpdatedBy === "string") patch.lastUpdatedBy = req.body.lastUpdatedBy;
      if (todayOrders !== void 0 && !isNaN(todayOrders)) patch.todayOrders = todayOrders;
      if (lat !== void 0 && !isNaN(lat)) patch.lat = lat;
      if (lng !== void 0 && !isNaN(lng)) patch.lng = lng;
      if (lat !== void 0 && !isNaN(lat)) patch.latitude = lat;
      if (lng !== void 0 && !isNaN(lng)) patch.longitude = lng;
      if (req.body.gpsValid !== void 0) patch.gpsValid = parseStrictBool(req.body.gpsValid);
      if (patch.lat !== void 0 && patch.lng !== void 0 && patch.lat !== 0 && patch.lng !== 0 && Math.abs(patch.lat) <= 90 && Math.abs(patch.lng) <= 180) patch.gpsValid = true;
      if (isOnline !== void 0) {
        patch.isOnline = isOnline;
        if (isOnline) {
          patch.kickedOfflineAt = 0;
          patch.kickReason = "";
        }
      }
      const dbData = readLocalJsonDb();
      const removedPhones = new Set(await readRemovedPhonesMergedUnified().catch(() => []));
      if (removedPhones.has(phone.replace(/\D/g, "")) && phone !== "15509601222") {
        if (dbData.squad_members && dbData.squad_members[phone]) {
          delete dbData.squad_members[phone];
        }
        if (dbData.driver_locations && dbData.driver_locations[phone]) {
          delete dbData.driver_locations[phone];
        }
        writeLocalJsonDb(dbData);
        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?) AND `doc_id` = ?",
              ["squad_members", "driver_locations", phone]
            );
          } catch (_) {
          }
        }
        return res.json({ success: true, removed: true, isOnline: false });
      }
      const collectionsToUpdate = ["driver_users", "driver_locations"];
      const prevLocSnapshot = { ...dbData.driver_locations?.[phone] || {} };
      const lastOfflineAt = Number(prevLocSnapshot.lastOfflineAt || 0);
      const isStaleOnlineFlip = isOnline === true && typeof req.body.lastUpdatedBy === "string" && lastOfflineAt > 0 && Date.now() - lastOfflineAt < 15e3;
      if (isStaleOnlineFlip) {
        delete patch.isOnline;
        delete patch.kickedOfflineAt;
        delete patch.kickReason;
      }
      collectionsToUpdate.forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      writeLocalJsonDb(dbData, false);
      if (isMySQLEnabled && mysqlPool) {
        const mergedLocation = { ...dbData.driver_locations?.[phone] || {}, ...patch, phone };
        const prevLoc = prevLocSnapshot;
        let skipMysql = false;
        if (lat !== void 0 && lng !== void 0 && !isNaN(lat) && !isNaN(lng) && prevLoc.lat !== void 0 && prevLoc.lng !== void 0) {
          const dLat = (lat - Number(prevLoc.lat)) * 111320;
          const dLng = (lng - Number(prevLoc.lng)) * 111320 * Math.cos(Number(prevLoc.lat) * Math.PI / 180);
          const distM = Math.sqrt(dLat * dLat + dLng * dLng);
          const statusChanged = isOnline !== void 0 && Boolean(prevLoc.isOnline) !== Boolean(isOnline) || isBusy !== void 0 && Boolean(prevLoc.isBusy) !== Boolean(isBusy);
          const statsChanged = todayOrders !== void 0 && !isNaN(todayOrders) && Number(prevLoc.todayOrders || 0) !== todayOrders;
          const lastFlush = _locMysqlFlushAt.get(phone) || 0;
          const flushDue = Date.now() - lastFlush >= 6e4;
          if (distM < 50 && !statusChanged && !statsChanged && !flushDue) skipMysql = true;
        }
        if (!skipMysql) _locMysqlFlushAt.set(phone, Date.now());
        if (!skipMysql) {
          mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)",
            ["driver_locations", phone, JSON.stringify(mergedLocation), JSON.stringify({ ...patch, phone })]
          ).catch(() => {
          });
          mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)",
            ["driver_users", phone, JSON.stringify({ ...dbData.driver_users?.[phone] || {}, ...patch, phone }), JSON.stringify({ ...patch, phone })]
          ).catch(() => {
          });
        }
      }
      return res.json({ success: true, isOnline: patch.isOnline !== void 0 ? patch.isOnline : Boolean(prevLocSnapshot.isOnline), serverTime: Date.now(), ...coordsIgnored ? { coordsIgnored: true } : {} });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.get("/api/driver/locations", requireDbAuth, async (req, res) => {
    try {
      const locations = {};
      const dbData = readLocalJsonDb();
      const removedPhones = /* @__PURE__ */ new Set();
      try {
        const removedCfg = dbData.config?.["removed_squad_members"]?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [cfgRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["config", "removed_squad_members"]
          );
          if (cfgRows && cfgRows.length > 0) {
            const parsedCfg = typeof cfgRows[0].data === "string" ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
            if (Array.isArray(parsedCfg?.phones)) {
              parsedCfg.phones.forEach((p) => removedPhones.add(String(p).trim()));
            }
          }
        } catch (_) {
        }
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["driver_locations"]
          );
          if (rows && Array.isArray(rows)) {
            rows.forEach((r) => {
              try {
                const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
                const phone = String(parsed?.phone || r.doc_id || "").trim();
                if (phone && (phone === "15509601222" || !removedPhones.has(phone))) {
                  locations[r.doc_id] = parsed;
                }
              } catch (_) {
              }
            });
          }
        } catch (_) {
        }
      }
      if (dbData.driver_locations) {
        Object.keys(dbData.driver_locations).forEach((k) => {
          const phone = String(dbData.driver_locations[k]?.phone || k || "").trim();
          if (phone && (phone === "15509601222" || !removedPhones.has(phone))) {
            if (!locations[k]) locations[k] = { ...dbData.driver_locations[k] };
          }
        });
      }
      try {
        const todayCounts = await getTodayOrderCounts();
        Object.keys(locations).forEach((k) => {
          const p = String(locations[k]?.phone || k || "").replace(/\D/g, "").trim();
          if (p) locations[k].todayOrders = todayCounts.get(p) || 0;
        });
      } catch (_) {
      }
      try {
        const memberPhonesLoc = /* @__PURE__ */ new Set();
        const addApprovedLoc = (doc, key) => {
          const p = String(doc?.phone || key || "").replace(/\D/g, "").trim();
          if (p && isApprovedMemberStatus(effectiveMemberStatus(doc)) && !removedPhones.has(p)) memberPhonesLoc.add(p);
        };
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [mrowsLoc] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              ["squad_members"]
            );
            (mrowsLoc || []).forEach((r) => {
              try {
                addApprovedLoc(typeof r.data === "string" ? JSON.parse(r.data) : r.data, String(r.doc_id || ""));
              } catch (_) {
              }
            });
          } catch (_) {
          }
        }
        Object.keys(dbData.squad_members || {}).forEach((k) => addApprovedLoc(dbData.squad_members[k], k));
        const requesterForLoc = String(req.authPhone || "").replace(/\D/g, "").trim();
        Object.keys(locations).forEach((k) => {
          const p = String(locations[k]?.phone || k || "").replace(/\D/g, "").trim();
          if (p === "15509601222" || p === requesterForLoc || memberPhonesLoc.has(p)) return;
          delete locations[k];
        });
      } catch (_) {
      }
      const cutoffMs = getMostRecent0559CutoffMs();
      Object.keys(locations).forEach((k) => {
        const item = locations[k];
        if (item && (item.isOnline === true || item.isOnline === "true")) {
          const t = docLatestTimeMs(item);
          if (t > 0 && t < cutoffMs) {
            locations[k] = { ...item, isOnline: false, onlineOrdersEnabled: false };
          }
        }
      });
      const entryRealPhone = /* @__PURE__ */ new Map();
      Object.keys(locations).forEach((k) => {
        const item = locations[k];
        if (item) entryRealPhone.set(item, String(item.phone || k || "").replace(/\D/g, "").trim());
      });
      try {
        const requesterPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
        let hasHubble = requesterPhone === "15509601222";
        if (!hasHubble) {
          if (isMySQLEnabled && mysqlPool) {
            const [hrows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["hubble_authorized_drivers", requesterPhone]
            );
            if (hrows && hrows.length > 0) {
              let hd = null;
              try {
                hd = typeof hrows[0].data === "string" ? JSON.parse(hrows[0].data) : hrows[0].data;
              } catch (_) {
              }
              hasHubble = !!hd && !hd._revoked;
            }
          } else {
            const hv = readLocalJsonDb()?.["hubble_authorized_drivers"]?.[requesterPhone];
            hasHubble = !!hv && !hv._revoked;
          }
        }
        if (!hasHubble) {
          const compoundSurnames = ["\u6B27\u9633", "\u8BF8\u845B", "\u53F8\u9A6C", "\u4E0A\u5B98", "\u590F\u4FAF", "\u4E1C\u65B9", "\u72EC\u5B64", "\u5357\u5BAB", "\u7687\u752B", "\u53F8\u5F92", "\u5C09\u8FDF", "\u516C\u5B59", "\u6155\u5BB9", "\u5B87\u6587"];
          const maskNameToSurname = (raw) => {
            const n = String(raw || "").trim();
            if (!n) return "\u67D0\u5E08\u5085";
            if (n.endsWith("\u5E08\u5085")) return n;
            if (/^司机\d+$/.test(n) || /^\d+$/.test(n)) return "\u67D0\u5E08\u5085";
            const ch = n.match(/[一-龥]+/);
            if (!ch) return "\u67D0\u5E08\u5085";
            const s = ch[0];
            const compound = compoundSurnames.find((x) => s.startsWith(x));
            return (compound || s[0]) + "\u5E08\u5085";
          };
          const keyRemap = /* @__PURE__ */ new Map();
          for (const k of Object.keys(locations)) {
            const itemPhone = String(locations[k]?.phone || k || "").replace(/\D/g, "").trim();
            if (itemPhone && itemPhone !== requesterPhone) {
              if (locations[k].driverName) locations[k].driverName = maskNameToSurname(locations[k].driverName);
              if (locations[k].name) locations[k].name = maskNameToSurname(locations[k].name);
              if (locations[k].phone) locations[k].phone = String(locations[k].phone).slice(0, 3) + "****" + String(locations[k].phone).slice(-4);
              keyRemap.set(k, String(locations[k].phone || k.slice(0, 3) + "****" + k.slice(-4)));
            }
          }
          for (const [oldK, baseK] of keyRemap) {
            let newK = baseK;
            let seq = 1;
            while (locations[newK] !== void 0 && newK !== oldK) {
              seq++;
              newK = `${baseK}#${seq}`;
            }
            if (newK !== oldK) {
              locations[newK] = locations[oldK];
              delete locations[oldK];
            }
          }
        }
      } catch (_) {
      }
      try {
        const pendingMapLocFold = await getPendingDispatchMap();
        Object.keys(locations).forEach((k) => {
          const item = locations[k];
          if (!item) return;
          const realPhone = entryRealPhone.get(item) || String(item.phone || k || "").replace(/\D/g, "").trim();
          const tripBusy = item.isBusy === true || item.isBusy === "true" || item.isBusy === 1;
          if (tripBusy) {
            item.busyReason = "trip";
            return;
          }
          const occ = occupancyOf(realPhone, pendingMapLocFold, item);
          if (occ.occupied) {
            item.isBusy = true;
            item.busyReason = occ.reason;
          } else {
            item.busyReason = null;
          }
        });
      } catch (_) {
      }
      return res.json({ success: true, locations });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.get("/api/squad/members", requireDbAuth, async (req, res) => {
    try {
      const list = [];
      const seen = /* @__PURE__ */ new Set();
      const mysqlMemberPhones = /* @__PURE__ */ new Set();
      let mysqlReadOk = !(isMySQLEnabled && mysqlPool);
      const dbData = readLocalJsonDb();
      const removedPhones = /* @__PURE__ */ new Set();
      try {
        const removedCfg = dbData.config?.["removed_squad_members"]?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [cfgRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["config", "removed_squad_members"]
          );
          if (cfgRows && cfgRows.length > 0) {
            const parsedCfg = typeof cfgRows[0].data === "string" ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
            if (Array.isArray(parsedCfg?.phones)) {
              parsedCfg.phones.forEach((p) => removedPhones.add(String(p).trim()));
            }
          }
        } catch (_) {
        }
      }
      const isInvalidDriver = (phone) => {
        if (!phone) return true;
        if (phone === "15509601222") return false;
        if (removedPhones.has(phone)) return true;
        return false;
      };
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["squad_members"]
          );
          mysqlReadOk = true;
          if (rows && Array.isArray(rows)) {
            rows.forEach((r) => {
              try {
                const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
                const phone = String(parsed?.phone || r.doc_id || "").trim();
                if (phone) mysqlMemberPhones.add(phone);
                if (phone && !seen.has(phone) && !isInvalidDriver(phone) && isApprovedMemberStatus(effectiveMemberStatus(parsed))) {
                  seen.add(phone);
                  list.push({ ...parsed, id: r.doc_id, phone, status: "\u5DF2\u901A\u8FC7" });
                }
              } catch (_) {
              }
            });
          }
        } catch (_) {
        }
      }
      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach((k) => {
          const m = dbData.squad_members[k];
          const phone = String(m?.phone || k || "").trim();
          if (phone && !seen.has(phone) && !mysqlMemberPhones.has(phone) && !isInvalidDriver(phone) && isApprovedMemberStatus(effectiveMemberStatus(m))) {
            seen.add(phone);
            list.push({ ...m, id: k, phone, status: "\u5DF2\u901A\u8FC7" });
          }
        });
      }
      if (!seen.has("15509601222")) {
        seen.add("15509601222");
        list.unshift({
          id: "15509601222",
          phone: "15509601222",
          name: "\u5434\u5F66\u7956",
          driverName: "\u5434\u5F66\u7956",
          role: "\u5F00\u53D1\u8005\u53F8\u673A",
          userRole: "\u5F00\u53D1\u8005\u53F8\u673A",
          status: "\u5DF2\u901A\u8FC7"
        });
      }
      if (mysqlReadOk) {
        try {
          _squadMembersLastGood = { at: Date.now(), list: JSON.parse(JSON.stringify(list)) };
        } catch (_) {
        }
      } else if (_squadMembersLastGood && Date.now() - _squadMembersLastGood.at < 10 * 60 * 1e3) {
        try {
          const snap = JSON.parse(JSON.stringify(_squadMembersLastGood.list));
          list.length = 0;
          snap.forEach((e) => list.push(e));
        } catch (_) {
        }
      }
      try {
        const QR_SLIM = ["wechatQrCode", "qrCode", "wechatClean", "alipayQrCode", "paymentQrCode", "driverQrCode", "qrcode_url"];
        const requesterDigits = String(req.authPhone || "").replace(/\D/g, "").trim();
        for (const entry of list) {
          const p = String(entry?.phone || entry?.id || "").replace(/\D/g, "").trim();
          if (!p || p === requesterDigits) continue;
          for (const f of QR_SLIM) {
            if (entry[f] !== void 0) delete entry[f];
          }
        }
      } catch (_) {
      }
      for (const entry of list) {
        try {
          const p = String(entry?.phone || entry?.id || "").replace(/\D/g, "").trim();
          const n = String(entry?.name || entry?.driverName || "").trim();
          if (!p || !isGenericDriverName(n, p)) continue;
          const healed = await resolveRealNameFromRecords(p).catch(() => "");
          if (!healed) continue;
          entry.name = healed;
          entry.driverName = healed;
          _authoritativeNameCache.delete(p);
          try {
            const healPayload = { name: healed, driverName: healed, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
            if (isMySQLEnabled && mysqlPool) {
              const [rows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                ["squad_members", p]
              );
              if (rows && rows.length > 0) {
                const existingDoc = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
                await mysqlPool.query(
                  "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                  ["squad_members", p, JSON.stringify({ ...existingDoc, ...healPayload })]
                );
              }
            }
            const dbDataHeal = readLocalJsonDb();
            if (dbDataHeal.squad_members?.[p]) {
              dbDataHeal.squad_members[p] = { ...dbDataHeal.squad_members[p], ...healPayload };
              writeLocalJsonDb(dbDataHeal);
            }
          } catch (_) {
          }
        } catch (_) {
        }
      }
      return res.json({ success: true, list });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post(["/api/driver/name", "/api/driver/update-name"], requireDbAuth, async (req, res) => {
    try {
      const rawPhone = String(req.body.phone || "").trim();
      const phone = rawPhone.replace(/\D/g, "");
      const name = String(req.body.name || "").trim().slice(0, 8);
      if (!phone || !name) {
        return res.status(400).json({ success: false, error: "Phone and name required" });
      }
      if (!req.isAdmin && phone.toUpperCase() !== String(req.authPhone || "").replace(/\D/g, "").toUpperCase()) {
        return res.status(403).json({ success: false, error: "\u65E0\u6743\u64CD\u4F5C\u4ED6\u4EBA\u6570\u636E" });
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          for (const col of ["driver_users", "squad_members", "driver_locations", "squad_applications", "online_applications", "team_members"]) {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, phone]
            );
            let merged = { phone, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: (/* @__PURE__ */ new Date()).toISOString() };
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
              merged = { ...prev, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: (/* @__PURE__ */ new Date()).toISOString() };
            }
            if ((!rows || rows.length === 0) && col !== "driver_users") continue;
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              [col, phone, JSON.stringify(merged)]
            );
          }
        } catch (_) {
        }
      }
      const dbData = readLocalJsonDb();
      for (const col of ["driver_users", "squad_members", "driver_locations", "online_applications", "squad_applications"]) {
        if (!dbData[col]) dbData[col] = {};
        if (!dbData[col][phone] && col !== "driver_users") continue;
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: (/* @__PURE__ */ new Date()).toISOString() };
      }
      for (const orderCol of ["merchant_orders", "orders"]) {
        if (dbData[orderCol]) {
          Object.keys(dbData[orderCol]).forEach((ordKey) => {
            const ord = dbData[orderCol][ordKey];
            if (!ord) return;
            const dPhone = String(ord.driverPhone || "").replace(/\D/g, "");
            const aPhone = String(ord.adminPhone || ord.dispatchedByPhone || ord.creatorPhone || ord.reporterPhone || "").replace(/\D/g, "");
            let orderChanged = false;
            if (dPhone === phone) {
              ord.driverName = name;
              ord.driverDisplayName = name;
              orderChanged = true;
            }
            if (aPhone === phone) {
              ord.adminName = name;
              ord.dispatchedByName = name;
              orderChanged = true;
            }
            if (orderChanged) {
              dbData[orderCol][ordKey] = ord;
            }
          });
        }
      }
      writeLocalJsonDb(dbData);
      return res.json({ success: true, phone, name });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  const getMostRecent0559CutoffMs = () => {
    const now = /* @__PURE__ */ new Date();
    const beijingMs = now.getTime() + now.getTimezoneOffset() * 6e4 + 8 * 36e5;
    const beijingDate = new Date(beijingMs);
    const cutoffDate = new Date(beijingDate);
    cutoffDate.setHours(5, 59, 0, 0);
    if (beijingDate.getTime() < cutoffDate.getTime()) {
      cutoffDate.setDate(cutoffDate.getDate() - 1);
    }
    return cutoffDate.getTime() - 8 * 36e5 - now.getTimezoneOffset() * 6e4;
  };
  const pendingOfflineDrivers = /* @__PURE__ */ new Map();
  let _hallPulseRunning = false;
  setInterval(async () => {
    if (_hallPulseRunning) return;
    _hallPulseRunning = true;
    try {
      const docs = await loadMerchantOrdersCanonical();
      const nowMs = Date.now();
      const bucket = Math.floor(nowMs / 15e3);
      for (const [docId, o] of docs) {
        if (!o || typeof o !== "object") continue;
        const st = String(o.status || "").trim();
        const inHall = o.in_hall === true || o.in_hall === "true";
        if (st !== "hall" && !inHall) continue;
        if (String(o.claimedDriverPhone || "").trim()) continue;
        const hallAtMs = Number(o.hallAt || o.timestamp || 0);
        if (hallAtMs > 0 && nowMs - hallAtMs > 24 * 3600 * 1e3) continue;
        if (Number(o.hallPulse || 0) === bucket) continue;
        const release = await acquireOrderLock(docId);
        try {
          let cur = null;
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [rows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                ["merchant_orders", docId]
              );
              if (rows && rows.length > 0) cur = typeof rows[0].data === "string" ? parseStoredDoc(rows[0].data) : rows[0].data;
            } catch (_) {
            }
          }
          if (!cur) {
            try {
              const raw = readLocalJsonDb()?.["merchant_orders"]?.[docId];
              cur = raw && typeof raw === "object" && typeof raw.data === "string" ? parseStoredDoc(raw.data) : raw || null;
            } catch (_) {
            }
          }
          if (!cur || typeof cur !== "object") continue;
          const cst = String(cur.status || "").trim();
          if (cst !== "hall" && !(cur.in_hall === true || cur.in_hall === "true")) continue;
          if (String(cur.claimedDriverPhone || "").trim()) continue;
          if (Number(cur.hallPulse || 0) === bucket) continue;
          const finalData = { ...cur, hallPulse: bucket };
          const dataStr = JSON.stringify(finalData);
          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["merchant_orders", docId, dataStr]
            );
          }
          try {
            const dbData = readLocalJsonDb();
            if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
            dbData["merchant_orders"][docId] = finalData;
            writeLocalJsonDb(dbData);
          } catch (_) {
          }
        } catch (_) {
        } finally {
          release();
        }
      }
    } catch (_) {
    } finally {
      _hallPulseRunning = false;
    }
  }, 15e3);
  const HALL_TIMEOUT_MS = 20 * 60 * 1e3;
  let _hallTimeoutRunning = false;
  setInterval(async () => {
    if (_hallTimeoutRunning) return;
    _hallTimeoutRunning = true;
    try {
      const docs = await loadMerchantOrdersCanonical();
      const nowMs = Date.now();
      for (const [docId, o] of docs) {
        if (!o || typeof o !== "object") continue;
        const st = String(o.status || "").trim();
        const inHall = o.in_hall === true || o.in_hall === "true";
        if (st !== "hall" && !inHall) continue;
        if (String(o.claimedDriverPhone || "").trim()) continue;
        const hallAtMs = Number(o.hallAt || o.timestamp || 0);
        if (!hallAtMs || nowMs - hallAtMs < HALL_TIMEOUT_MS) continue;
        const release = await acquireOrderLock(docId);
        try {
          let cur = null;
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [rows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                ["merchant_orders", docId]
              );
              if (rows && rows.length > 0) cur = typeof rows[0].data === "string" ? parseStoredDoc(rows[0].data) : rows[0].data;
            } catch (_) {
            }
          }
          if (!cur) {
            try {
              const raw = readLocalJsonDb()?.["merchant_orders"]?.[docId];
              cur = raw && typeof raw === "object" && typeof raw.data === "string" ? parseStoredDoc(raw.data) : raw || null;
            } catch (_) {
            }
          }
          if (!cur || typeof cur !== "object") continue;
          const cst = String(cur.status || "").trim();
          if (cst !== "hall" && !(cur.in_hall === true || cur.in_hall === "true")) continue;
          if (String(cur.claimedDriverPhone || "").trim()) continue;
          const curHallAt = Number(cur.hallAt || cur.timestamp || 0);
          if (!curHallAt || Date.now() - curHallAt < HALL_TIMEOUT_MS) continue;
          const finalData = {
            ...cur,
            status: "cancelled",
            statusCategory: "\u5DF2\u53D6\u6D88",
            isCancelled: true,
            in_hall: false,
            cancelledAt: Date.now(),
            cancelledBy: "system",
            cancelledByRole: "system",
            cancelReason: "\u9009\u5355\u5927\u538520\u5206\u949F\u65E0\u4EBA\u63A5\u5355\uFF0C\u7CFB\u7EDF\u81EA\u52A8\u53D6\u6D88"
          };
          const dataStr = JSON.stringify(finalData);
          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["merchant_orders", docId, dataStr]
            );
          }
          try {
            const dbData = readLocalJsonDb();
            if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
            dbData["merchant_orders"][docId] = finalData;
            writeLocalJsonDb(dbData);
          } catch (_) {
          }
          console.log(`[HallTimeoutCancel] \u5927\u5385\u8BA2\u5355 ${docId} \u8FDB\u5385\u6EE120\u5206\u949F\u65E0\u4EBA\u63A5\u5355\uFF0C\u5DF2\u81EA\u52A8\u53D6\u6D88`);
        } catch (_) {
        } finally {
          release();
        }
      }
    } catch (_) {
    } finally {
      _hallTimeoutRunning = false;
    }
  }, 3e4);
  const VIP_PACKAGES_SEED = [
    { id: "lifetime", days: 99999, price: 158, label: "\u6C38\u4E45\u4F1A\u5458" },
    { id: "365days", days: 365, price: 78, label: "365\u5929" },
    { id: "180days", days: 180, price: 45, label: "180\u5929" },
    { id: "90days", days: 90, price: 25, label: "90\u5929" },
    { id: "30days", days: 30, price: 9.9, label: "30\u5929" }
  ];
  let _vipPackagesCache = { at: 0, packages: [] };
  function sanitizeVipPackages(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 10) return null;
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of input) {
      if (!raw || typeof raw !== "object") return null;
      const id = String(raw.id || "").trim();
      if (!id || id.length > 32 || seen.has(id)) return null;
      seen.add(id);
      const days = Number(raw.days);
      if (!Number.isInteger(days) || days <= 0 || days > 99999) return null;
      const price = Number(raw.price);
      if (!Number.isFinite(price) || price < 0.01 || price > 1e5) return null;
      let label = String(raw.label || "").trim();
      if (!label) label = days === 99999 ? "\u6C38\u4E45\u4F1A\u5458" : `${days}\u5929`;
      if (label.length > 32) label = label.slice(0, 32);
      out.push({ id, days, price: Math.round(price * 100) / 100, label });
    }
    return out;
  }
  async function writeVipPackagesConfig(packages) {
    const docObj = { packages, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["config", "vip_packages", JSON.stringify(docObj)]
      );
    }
    try {
      const dbData = readLocalJsonDb();
      if (!dbData["config"]) dbData["config"] = {};
      dbData["config"]["vip_packages"] = docObj;
      writeLocalJsonDb(dbData);
    } catch (_) {
    }
    _vipPackagesCache = { at: Date.now(), packages };
  }
  async function getVipPackages() {
    if (_vipPackagesCache.packages.length && Date.now() - _vipPackagesCache.at < 15e3) {
      return _vipPackagesCache.packages;
    }
    let pkgs = null;
    try {
      const doc = await readCanonicalDocument("config", "vip_packages");
      if (doc) pkgs = sanitizeVipPackages(doc.packages);
    } catch (_) {
    }
    if (!pkgs) {
      pkgs = VIP_PACKAGES_SEED.map((p) => ({ ...p }));
      try {
        await writeVipPackagesConfig(pkgs);
      } catch (e) {
        console.error("[VipPackages] \u79CD\u5B50\u914D\u7F6E\u843D\u76D8\u5931\u8D25:", e?.message || e);
      }
    }
    _vipPackagesCache = { at: Date.now(), packages: pkgs };
    return pkgs;
  }
  function normalizeAlipayPem(raw, kind) {
    let s = String(raw || "").trim();
    if (!s) return "";
    s = s.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
    if (s.includes("-----BEGIN")) return s;
    const b64 = s.replace(/\s+/g, "");
    if (!b64) return "";
    const lines = (b64.match(/.{1,64}/g) || [b64]).join("\n");
    return kind === "private" ? `-----BEGIN PRIVATE KEY-----
${lines}
-----END PRIVATE KEY-----` : `-----BEGIN PUBLIC KEY-----
${lines}
-----END PUBLIC KEY-----`;
  }
  function loadAlipayPrivateKey() {
    const pem = normalizeAlipayPem(process.env.ALIPAY_PRIVATE_KEY, "private");
    if (!pem) return null;
    try {
      return import_crypto.default.createPrivateKey(pem);
    } catch (_) {
    }
    if (pem.includes("BEGIN PRIVATE KEY")) {
      try {
        return import_crypto.default.createPrivateKey(pem.replace(/PRIVATE KEY/g, "RSA PRIVATE KEY"));
      } catch (_) {
      }
    }
    console.error("[Alipay] ALIPAY_PRIVATE_KEY \u89E3\u6790\u5931\u8D25\uFF08\u65E2\u975E PEM \u4E5F\u975E\u53EF\u8BC6\u522B\u7684\u88F8 base64\uFF09");
    return null;
  }
  function loadAlipayPublicKey() {
    const pem = normalizeAlipayPem(process.env.ALIPAY_PUBLIC_KEY, "public");
    if (!pem) return null;
    try {
      return import_crypto.default.createPublicKey(pem);
    } catch (e) {
      console.error("[Alipay] ALIPAY_PUBLIC_KEY \u89E3\u6790\u5931\u8D25:", e?.message || e);
      return null;
    }
  }
  function getAlipayConfig() {
    return {
      appId: String(process.env.ALIPAY_APP_ID || "2021007112614985").trim(),
      notifyUrl: String(process.env.ALIPAY_NOTIFY_URL || "https://api.lyheiwandaijiamax.com/api/pay/alipay/notify").trim(),
      sellerId: String(process.env.ALIPAY_SELLER_ID || "").trim(),
      privateKey: loadAlipayPrivateKey(),
      publicKey: loadAlipayPublicKey()
    };
  }
  function alipaySignContent(params, forNotifyVerify) {
    return Object.keys(params).filter((k) => k !== "sign" && (!forNotifyVerify || k !== "sign_type")).filter((k) => params[k] !== void 0 && params[k] !== null && params[k] !== "").sort().map((k) => `${k}=${params[k]}`).join("&");
  }
  function fmtYmd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseYmdStrict(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (dt.getFullYear() !== Number(m[1]) || dt.getMonth() !== Number(m[2]) - 1 || dt.getDate() !== Number(m[3])) return null;
    return dt;
  }
  function computeVipExtension(currentVip, days) {
    if (days === 99999) return "\u6C38\u4E45\u6709\u6548";
    const cur = String(currentVip || "").trim();
    if (cur === "\u6C38\u4E45\u6709\u6548" || cur === "\u6C38\u4E45") return "\u6C38\u4E45\u6709\u6548";
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    let base = today;
    const curDate = parseYmdStrict(cur);
    if (curDate && curDate.getTime() > today.getTime()) base = curDate;
    const out = new Date(base);
    out.setDate(out.getDate() + days);
    return fmtYmd(out);
  }
  async function readDriverVipExpiry(phone) {
    const du = await Promise.resolve(readCanonicalDocument("driver_users", phone)).catch(() => null);
    if (du && du.vipExpiry !== void 0 && du.vipExpiry !== null && String(du.vipExpiry).trim() !== "") return String(du.vipExpiry).trim();
    const sm = await Promise.resolve(readCanonicalDocument("squad_members", phone)).catch(() => null);
    if (sm && sm.vipExpiry !== void 0 && sm.vipExpiry !== null) return String(sm.vipExpiry).trim();
    return "";
  }
  async function applyVipExpiryToDriver(phone, vipExpiry) {
    const dbData = readLocalJsonDb();
    const targetCols = ["driver_users", "squad_members"];
    let wroteAny = false;
    for (const col of targetCols) {
      const existing = await Promise.resolve(readCanonicalDocument(col, phone));
      if (!existing) continue;
      wroteAny = true;
      if (!dbData[col]) dbData[col] = {};
      const updated = {
        ...existing,
        phone,
        phoneNumber: phone,
        vipExpiry,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      dbData[col][phone] = updated;
      if (isMySQLEnabled && mysqlPool) {
        const upsertSql = "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)";
        const upsertArgs = [col, phone, JSON.stringify(updated)];
        let mysqlOk = false;
        let lastMysqlErr = null;
        for (let attempt = 0; attempt < 3 && !mysqlOk; attempt++) {
          try {
            await mysqlPool.query(upsertSql, upsertArgs);
            mysqlOk = true;
          } catch (e) {
            lastMysqlErr = e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          }
        }
        if (!mysqlOk) {
          console.error("[VipPay MySQL Write Failed]:", col, phone, lastMysqlErr?.message || lastMysqlErr);
          throw new Error(`MySQL \u5199\u5165\u5931\u8D25(${col})\uFF1A${lastMysqlErr?.message || lastMysqlErr}`);
        }
      }
    }
    if (!wroteAny) return false;
    writeLocalJsonDb(dbData, true);
    return true;
  }
  async function writePayOrderDoc(order) {
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["pay_orders", order.outTradeNo, JSON.stringify(order)]
      );
    }
    try {
      const dbData = readLocalJsonDb();
      if (!dbData["pay_orders"]) dbData["pay_orders"] = {};
      dbData["pay_orders"][order.outTradeNo] = order;
      writeLocalJsonDb(dbData);
    } catch (_) {
    }
  }
  app.get("/api/shop/vip-packages", async (req, res) => {
    try {
      const packages = await getVipPackages();
      return res.json({ ok: true, packages });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u8BFB\u53D6\u5957\u9910\u5931\u8D25" });
    }
  });
  app.post("/api/admin/vip-packages", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ ok: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const packages = sanitizeVipPackages(req.body?.packages);
      if (!packages) {
        return res.status(400).json({ ok: false, error: "\u5957\u9910\u683C\u5F0F\u65E0\u6548\uFF1A\u9700 1-10 \u6761\u3001id \u552F\u4E00\u3001\u5929\u6570\u4E3A\u6B63\u6574\u6570\u3001\u4EF7\u683C 0.01~100000" });
      }
      await writeVipPackagesConfig(packages);
      const summary = packages.map((p) => `${p.label}\xA5${p.price}`).join("\u3001");
      await logAdminOperation("update-vip-packages", String(req.authPhone || ""), "", `\u4F1A\u5458\u5957\u9910\u66F4\u65B0\uFF1A${summary}`, req).catch(() => {
      });
      return res.json({ ok: true, packages });
    } catch (e) {
      console.error("[Admin VipPackages Update Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u4FDD\u5B58\u5957\u9910\u5931\u8D25" });
    }
  });
  app.post("/api/pay/alipay/create-order", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(400).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u80FD\u8D2D\u4E70\u4F1A\u5458" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u767B\u5F55\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const packageId = String(req.body?.packageId || "").trim();
      const packages = await getVipPackages();
      const pkg = packages.find((p) => p.id === packageId);
      if (!pkg) {
        return res.status(400).json({ ok: false, error: "\u5957\u9910\u4E0D\u5B58\u5728" });
      }
      const ali = getAlipayConfig();
      if (!ali.privateKey) {
        return res.status(500).json({ ok: false, error: "alipay_not_configured", message: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u652F\u4ED8\u5B9D\u79C1\u94A5\uFF08ALIPAY_PRIVATE_KEY\uFF09" });
      }
      const outTradeNo = `VIP${Date.now()}${phone.slice(-4)}${import_crypto.default.randomBytes(3).toString("hex").toUpperCase()}`;
      const order = {
        id: outTradeNo,
        outTradeNo,
        phone,
        packageId: pkg.id,
        days: pkg.days,
        amount: pkg.price,
        status: "pending",
        tradeNo: "",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writePayOrderDoc(order);
      const bizContent = JSON.stringify({
        subject: `\u9ED1\u6E7E\u4EE3\u9A7EMAX\u4F1A\u5458-${pkg.label}`,
        out_trade_no: outTradeNo,
        total_amount: pkg.price.toFixed(2),
        product_code: "QUICK_MSECURITY_PAY",
        timeout_express: "30m"
      });
      const ts = /* @__PURE__ */ new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const params = {
        app_id: ali.appId,
        method: "alipay.trade.app.pay",
        charset: "utf-8",
        sign_type: "RSA2",
        timestamp: `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`,
        version: "1.0",
        notify_url: ali.notifyUrl,
        biz_content: bizContent
      };
      const signer = import_crypto.default.createSign("RSA-SHA256");
      signer.update(alipaySignContent(params, false), "utf8");
      const sign = signer.sign(ali.privateKey, "base64");
      const orderString = [...Object.keys(params).sort(), "sign"].map((k) => `${k}=${encodeURIComponent(k === "sign" ? sign : params[k])}`).join("&");
      console.log(`[Alipay CreateOrder] phone=${phone} pkg=${pkg.id} amount=${pkg.price} outTradeNo=${outTradeNo}`);
      return res.json({ ok: true, outTradeNo, orderString });
    } catch (e) {
      console.error("[Alipay CreateOrder Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u521B\u5EFA\u8BA2\u5355\u5931\u8D25" });
    }
  });
  app.post("/api/pay/alipay/notify", async (req, res) => {
    const fail = (why, extra) => {
      console.warn(`[Alipay Notify] \u6821\u9A8C\u5931\u8D25: ${why}`, extra !== void 0 ? JSON.stringify(extra) : "");
      return res.type("text/plain").send("failure");
    };
    try {
      const params = {};
      for (const [k, v] of Object.entries(req.body || {})) params[k] = String(v ?? "");
      const ali = getAlipayConfig();
      if (!ali.publicKey) return fail("\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u652F\u4ED8\u5B9D\u516C\u94A5 ALIPAY_PUBLIC_KEY");
      const sign = String(params.sign || "");
      if (!sign) return fail("\u7F3A\u5C11 sign");
      let verified = false;
      try {
        const verifier = import_crypto.default.createVerify("RSA-SHA256");
        verifier.update(alipaySignContent(params, true), "utf8");
        verified = verifier.verify(ali.publicKey, sign, "base64");
      } catch (e) {
        return fail("\u9A8C\u7B7E\u5F02\u5E38: " + (e?.message || e));
      }
      if (!verified) return fail("\u9A8C\u7B7E\u4E0D\u901A\u8FC7", { out_trade_no: params.out_trade_no });
      if (String(params.app_id || "") !== ali.appId) return fail("app_id \u4E0D\u5339\u914D", { app_id: params.app_id });
      if (ali.sellerId && String(params.seller_id || "") !== ali.sellerId) return fail("seller_id \u4E0D\u5339\u914D", { seller_id: params.seller_id });
      const outTradeNo = String(params.out_trade_no || "").trim();
      if (!outTradeNo) return fail("\u7F3A\u5C11 out_trade_no");
      const peek = await Promise.resolve(readCanonicalDocument("pay_orders", outTradeNo)).catch(() => null);
      if (!peek) return fail("\u8BA2\u5355\u4E0D\u5B58\u5728", { outTradeNo });
      const release = await acquireOrderLock(`payvip:${peek.phone}`);
      try {
        const order = await Promise.resolve(readCanonicalDocument("pay_orders", outTradeNo)).catch(() => null);
        if (!order) return fail("\u8BA2\u5355\u4E0D\u5B58\u5728", { outTradeNo });
        if (order.status === "paid") return res.type("text/plain").send("success");
        const totalAmount = Number(params.total_amount);
        if (!Number.isFinite(totalAmount) || Math.round(totalAmount * 100) !== Math.round(Number(order.amount) * 100)) {
          return fail("\u91D1\u989D\u4E0D\u4E00\u81F4", { notify: params.total_amount, order: order.amount });
        }
        const tradeStatus = String(params.trade_status || "");
        if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
          return fail("trade_status \u975E\u6210\u529F\u7EC8\u6001", { tradeStatus });
        }
        if (String(order.type || "") === "wallet") {
          const wPhone = String(order.phone);
          if (!order.walletCredited) {
            const releaseW = await acquireOrderLock(`wallet:${wPhone}`);
            try {
              const wdoc = await readWalletDoc(wPhone);
              const creditCents = Math.round(Number(order.amount) * 100);
              wdoc.balanceCents += creditCents;
              pushWalletLog(wdoc, {
                type: "recharge",
                amountCents: creditCents,
                balanceAfterCents: wdoc.balanceCents,
                note: `\u652F\u4ED8\u5B9D\u5145\u503C \xA5${fmtMoneyShort(Number(order.amount))}`,
                ref: outTradeNo
              });
              await saveWalletDoc(wdoc);
            } finally {
              releaseW();
            }
            await writePayOrderDoc({ ...order, walletCredited: true, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
          }
          await writePayOrderDoc({
            ...order,
            walletCredited: true,
            status: "paid",
            tradeNo: String(params.trade_no || ""),
            paidAt: (/* @__PURE__ */ new Date()).toISOString(),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          console.log(`[Alipay Notify] \u94B1\u5305\u5145\u503C\u6210\u529F phone=${wPhone} outTradeNo=${outTradeNo} amount=${order.amount}`);
          return res.type("text/plain").send("success");
        }
        const phone = String(order.phone);
        const currentVip = await readDriverVipExpiry(phone);
        let targetVip = String(order.vipExtendTarget || "");
        if (!targetVip) {
          targetVip = computeVipExtension(currentVip, Number(order.days));
          await writePayOrderDoc({ ...order, vipExtendTarget: targetVip, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
          const applied = await applyVipExpiryToDriver(phone, targetVip);
          if (!applied) return fail("\u53F8\u673A\u6587\u6863\u4E0D\u5B58\u5728\uFF0C\u4F1A\u5458\u53D1\u653E\u5931\u8D25", { phone });
        } else {
          const curDate = parseYmdStrict(currentVip);
          const tgtDate = parseYmdStrict(targetVip);
          const alreadyApplied = currentVip === "\u6C38\u4E45\u6709\u6548" || currentVip === targetVip || curDate !== null && tgtDate !== null && curDate.getTime() >= tgtDate.getTime();
          if (!alreadyApplied) {
            const applied = await applyVipExpiryToDriver(phone, targetVip);
            if (!applied) return fail("\u53F8\u673A\u6587\u6863\u4E0D\u5B58\u5728\uFF0C\u4F1A\u5458\u53D1\u653E\u5931\u8D25", { phone });
          }
        }
        await writePayOrderDoc({
          ...order,
          status: "paid",
          tradeNo: String(params.trade_no || ""),
          paidAt: (/* @__PURE__ */ new Date()).toISOString(),
          vipExtendTarget: targetVip,
          vipExpiryAfter: targetVip,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        console.log(`[Alipay Notify] \u652F\u4ED8\u6210\u529F phone=${phone} outTradeNo=${outTradeNo} tradeNo=${params.trade_no} vipExpiry->${targetVip}`);
        return res.type("text/plain").send("success");
      } finally {
        release();
      }
    } catch (e) {
      console.error("[Alipay Notify Error]:", e);
      return res.type("text/plain").send("failure");
    }
  });
  app.get("/api/pay/order-status", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(403).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\u4E0D\u80FD\u67E5\u8BE2\u4F1A\u5458\u8BA2\u5355" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      const outTradeNo = String(req.query.outTradeNo || "").trim();
      if (!outTradeNo) {
        return res.status(400).json({ ok: false, error: "\u7F3A\u5C11 outTradeNo" });
      }
      const order = await Promise.resolve(readCanonicalDocument("pay_orders", outTradeNo)).catch(() => null);
      if (!order || String(order.phone) !== phone) {
        return res.status(404).json({ ok: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      const vipExpiry = await readDriverVipExpiry(phone);
      const out = { ok: true, status: String(order.status || "pending"), vipExpiry };
      if (String(order.type || "") === "wallet") {
        out.orderType = "wallet";
        const wdoc = await readWalletDoc(phone).catch(() => null);
        out.walletBalanceCents = wdoc ? wdoc.balanceCents : 0;
      }
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u67E5\u8BE2\u8BA2\u5355\u5931\u8D25" });
    }
  });
  const WAP_SITE_BASE = "https://lyheiwandaijiamax.com";
  function wapEntrySign(secret, payload) {
    return import_crypto.default.createHmac("sha256", secret).update(payload).digest("hex");
  }
  async function createWapEntryToken(phone, kind) {
    const secret = await getDownloadSecret();
    const exp = Date.now() + 30 * 60 * 1e3;
    const payload = `${phone}.${kind}.${exp}`;
    return `${Buffer.from(payload, "utf8").toString("base64url")}.${wapEntrySign(secret, payload)}`;
  }
  async function resolveWapEntryToken(token, kind) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
      const payload = Buffer.from(parts[0], "base64url").toString("utf8");
      const secret = await getDownloadSecret();
      const expect = wapEntrySign(secret, payload);
      const a = Buffer.from(parts[1]);
      const b = Buffer.from(expect);
      if (a.length !== b.length || !import_crypto.default.timingSafeEqual(a, b)) return null;
      const segs = payload.split(".");
      if (segs.length !== 3 || segs[1] !== kind) return null;
      if (!/^1[3-9]\d{9}$/.test(segs[0])) return null;
      if (!(Number(segs[2]) > Date.now())) return null;
      return segs[0];
    } catch (_) {
      return null;
    }
  }
  app.post("/api/pay/wap-entry", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(400).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u80FD\u8D2D\u4E70/\u5145\u503C" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u767B\u5F55\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const kind = req.body?.kind === "wallet" ? "wallet" : "vip";
      const token = await createWapEntryToken(phone, kind);
      const page = kind === "wallet" ? "topup" : "vip";
      return res.json({ ok: true, url: `${WAP_SITE_BASE}/${page}?t=${encodeURIComponent(token)}` });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u751F\u6210\u8D2D\u4E70\u5165\u53E3\u5931\u8D25" });
    }
  });
  app.get("/api/pay/review-entry", async (req, res) => {
    try {
      const cfg = await Promise.resolve(readCanonicalDocument("config", "review_entry")).catch(() => null);
      const key = String(cfg?.key || "");
      if (!key || cfg?.enabled === false) return res.status(404).send("not found");
      const given = Buffer.from(String(req.query?.k || ""));
      const expect = Buffer.from(key);
      if (given.length !== expect.length || !import_crypto.default.timingSafeEqual(given, expect)) {
        return res.status(404).send("not found");
      }
      const REVIEW_PHONE = "15121904440";
      const token = await createWapEntryToken(REVIEW_PHONE, "vip");
      return res.redirect(302, `${WAP_SITE_BASE}/vip?t=${encodeURIComponent(token)}`);
    } catch (_) {
      return res.status(500).send("error");
    }
  });
  app.post("/api/pay/alipay/create-wap-order", async (req, res) => {
    try {
      const phone = await resolveWapEntryToken(String(req.body?.token || ""), "vip");
      if (!phone) {
        return res.status(400).json({ ok: false, error: "\u8D2D\u4E70\u94FE\u63A5\u5DF2\u5931\u6548\uFF0C\u8BF7\u56DE App \u91CD\u65B0\u6253\u5F00\u8D2D\u4E70\u9875" });
      }
      const packageId = String(req.body?.packageId || "").trim();
      const packages = await getVipPackages();
      const pkg = packages.find((p) => p.id === packageId);
      if (!pkg) {
        return res.status(400).json({ ok: false, error: "\u5957\u9910\u4E0D\u5B58\u5728" });
      }
      const du = await Promise.resolve(readCanonicalDocument("driver_users", phone)).catch(() => null);
      const sm = du ? null : await Promise.resolve(readCanonicalDocument("squad_members", phone)).catch(() => null);
      if (!du && !sm) {
        return res.status(400).json({ ok: false, error: "\u8BE5\u624B\u673A\u53F7\u5C1A\u672A\u6CE8\u518C\u9ED1\u6E7E\u4EE3\u9A7EMAX\uFF0C\u8BF7\u5148\u5728 App \u5185\u6CE8\u518C\u540E\u518D\u8D2D\u4E70" });
      }
      const ali = getAlipayConfig();
      if (!ali.privateKey) {
        return res.status(500).json({ ok: false, error: "alipay_not_configured", message: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u652F\u4ED8\u5B9D\u79C1\u94A5\uFF08ALIPAY_PRIVATE_KEY\uFF09" });
      }
      try {
        const dbData = readLocalJsonDb();
        const orders = dbData["pay_orders"] || {};
        const now = Date.now();
        for (const o of Object.values(orders)) {
          if (o && o.channel === "wap" && String(o.phone) === phone && String(o.packageId) === pkg.id && o.status === "pending") {
            const age = now - new Date(o.createdAt || 0).getTime();
            if (age >= 0 && age < 25 * 60 * 1e3) {
              return res.json({ ok: true, outTradeNo: o.outTradeNo, reused: true });
            }
          }
        }
      } catch (_) {
      }
      const outTradeNo = `WAP${Date.now()}${phone.slice(-4)}${import_crypto.default.randomBytes(3).toString("hex").toUpperCase()}`;
      const order = {
        id: outTradeNo,
        outTradeNo,
        phone,
        packageId: pkg.id,
        days: pkg.days,
        amount: pkg.price,
        status: "pending",
        tradeNo: "",
        channel: "wap",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writePayOrderDoc(order);
      console.log(`[Alipay WapCreateOrder] phone=${phone} pkg=${pkg.id} amount=${pkg.price} outTradeNo=${outTradeNo}`);
      return res.json({ ok: true, outTradeNo });
    } catch (e) {
      console.error("[Alipay WapCreateOrder Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u521B\u5EFA\u8BA2\u5355\u5931\u8D25" });
    }
  });
  app.post("/api/pay/alipay/create-wap-recharge-order", async (req, res) => {
    try {
      const phone = await resolveWapEntryToken(String(req.body?.token || ""), "wallet");
      if (!phone) {
        return res.status(400).json({ ok: false, error: "\u5145\u503C\u94FE\u63A5\u5DF2\u5931\u6548\uFF0C\u8BF7\u56DE App \u91CD\u65B0\u6253\u5F00\u5145\u503C\u9875" });
      }
      const cfg = await getWalletConfig();
      const amountCents = Math.round(Number(req.body?.amount) * 100);
      const amount = cfg.rechargeAmounts.find((a) => Math.round(a * 100) === amountCents);
      if (!amount) {
        return res.status(400).json({ ok: false, error: "\u5145\u503C\u91D1\u989D\u4E0D\u5728\u53EF\u9009\u6863\u4F4D\u5185" });
      }
      const du = await Promise.resolve(readCanonicalDocument("driver_users", phone)).catch(() => null);
      const sm = du ? null : await Promise.resolve(readCanonicalDocument("squad_members", phone)).catch(() => null);
      if (!du && !sm) {
        return res.status(400).json({ ok: false, error: "\u8BE5\u624B\u673A\u53F7\u5C1A\u672A\u6CE8\u518C\u9ED1\u6E7E\u4EE3\u9A7EMAX\uFF0C\u8BF7\u5148\u5728 App \u5185\u6CE8\u518C\u540E\u518D\u5145\u503C" });
      }
      const ali = getAlipayConfig();
      if (!ali.privateKey) {
        return res.status(500).json({ ok: false, error: "alipay_not_configured", message: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u652F\u4ED8\u5B9D\u79C1\u94A5\uFF08ALIPAY_PRIVATE_KEY\uFF09" });
      }
      try {
        const dbData = readLocalJsonDb();
        const orders = dbData["pay_orders"] || {};
        const now = Date.now();
        for (const o of Object.values(orders)) {
          if (o && o.channel === "wap" && String(o.type || "") === "wallet" && String(o.phone) === phone && Math.round(Number(o.amount) * 100) === amountCents && o.status === "pending") {
            const age = now - new Date(o.createdAt || 0).getTime();
            if (age >= 0 && age < 25 * 60 * 1e3) {
              return res.json({ ok: true, outTradeNo: o.outTradeNo, reused: true });
            }
          }
        }
      } catch (_) {
      }
      const outTradeNo = `WAL${Date.now()}${phone.slice(-4)}${import_crypto.default.randomBytes(3).toString("hex").toUpperCase()}`;
      const order = {
        id: outTradeNo,
        outTradeNo,
        type: "wallet",
        phone,
        amount,
        status: "pending",
        tradeNo: "",
        channel: "wap",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writePayOrderDoc(order);
      console.log(`[Alipay WapRechargeOrder] phone=${phone} amount=${amount} outTradeNo=${outTradeNo}`);
      return res.json({ ok: true, outTradeNo });
    } catch (e) {
      console.error("[Alipay WapRechargeOrder Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u521B\u5EFA\u5145\u503C\u8BA2\u5355\u5931\u8D25" });
    }
  });
  app.get("/api/pay/wap-order", async (req, res) => {
    try {
      const outTradeNo = String(req.query.o || "").trim();
      if (!outTradeNo) return res.status(400).json({ ok: false, error: "\u7F3A\u5C11\u8BA2\u5355\u53F7" });
      const order = await Promise.resolve(readCanonicalDocument("pay_orders", outTradeNo)).catch(() => null);
      if (!order || String(order.channel || "") !== "wap") {
        return res.status(404).json({ ok: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      const packages = await getVipPackages();
      const pkg = packages.find((p) => p.id === String(order.packageId));
      const phone = String(order.phone || "");
      const isWallet = String(order.type || "") === "wallet";
      return res.json({
        ok: true,
        outTradeNo,
        orderType: isWallet ? "wallet" : "vip",
        packageLabel: isWallet ? "\u77ED\u4FE1\u4F59\u989D\u5145\u503C" : pkg ? pkg.label : `${order.days}\u5929`,
        days: isWallet ? 0 : Number(order.days),
        amount: Number(order.amount),
        phoneMasked: phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone,
        status: String(order.status || "pending"),
        vipExpiryAfter: String(order.vipExpiryAfter || "")
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u67E5\u8BE2\u8BA2\u5355\u5931\u8D25" });
    }
  });
  app.post("/api/pay/alipay/wap-pay", async (req, res) => {
    try {
      const outTradeNo = String(req.body?.outTradeNo || "").trim();
      if (!outTradeNo) return res.status(400).json({ ok: false, error: "\u7F3A\u5C11\u8BA2\u5355\u53F7" });
      const order = await Promise.resolve(readCanonicalDocument("pay_orders", outTradeNo)).catch(() => null);
      if (!order || String(order.channel || "") !== "wap") {
        return res.status(404).json({ ok: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      if (String(order.status) === "paid") {
        return res.json({ ok: true, status: "paid" });
      }
      const ali = getAlipayConfig();
      if (!ali.privateKey) {
        return res.status(500).json({ ok: false, error: "alipay_not_configured", message: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u652F\u4ED8\u5B9D\u79C1\u94A5\uFF08ALIPAY_PRIVATE_KEY\uFF09" });
      }
      const packages = await getVipPackages();
      const pkg = packages.find((p) => p.id === String(order.packageId));
      const isWallet = String(order.type || "") === "wallet";
      const subject = isWallet ? `\u9ED1\u6E7E\u4EE3\u9A7EMAX\u77ED\u4FE1\u4F59\u989D\u5145\u503C${fmtMoneyShort(Number(order.amount))}\u5143` : `\u9ED1\u6E7E\u4EE3\u9A7EMAX\u4F1A\u5458-${pkg ? pkg.label : `${order.days}\u5929`}`;
      const bizContent = JSON.stringify({
        subject,
        out_trade_no: outTradeNo,
        total_amount: Number(order.amount).toFixed(2),
        product_code: "QUICK_WAP_WAY",
        quit_url: `${WAP_SITE_BASE}${isWallet ? "/topup" : "/vip"}`,
        timeout_express: "30m"
      });
      const ts = /* @__PURE__ */ new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const params = {
        app_id: ali.appId,
        method: "alipay.trade.wap.pay",
        charset: "utf-8",
        sign_type: "RSA2",
        timestamp: `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`,
        version: "1.0",
        notify_url: ali.notifyUrl,
        return_url: `${WAP_SITE_BASE}/pay?o=${encodeURIComponent(outTradeNo)}`,
        biz_content: bizContent
      };
      const signer = import_crypto.default.createSign("RSA-SHA256");
      signer.update(alipaySignContent(params, false), "utf8");
      const sign = signer.sign(ali.privateKey, "base64");
      const query = [...Object.keys(params).sort(), "sign"].map((k) => `${k}=${encodeURIComponent(k === "sign" ? sign : params[k])}`).join("&");
      console.log(`[Alipay WapPay] outTradeNo=${outTradeNo} amount=${order.amount}`);
      return res.json({ ok: true, payUrl: `https://openapi.alipay.com/gateway.do?${query}` });
    } catch (e) {
      console.error("[Alipay WapPay Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u7EC4\u88C5\u652F\u4ED8\u94FE\u63A5\u5931\u8D25" });
    }
  });
  const SMS_SERVICE_SIGN_NAME = "\u626C\u6E7E\u9014\u4FE1\u606F";
  const SMS_START_BODY = "\u60A8\u7684\u4EE3\u9A7E\u670D\u52A1\u5DF2\u7ECF\u5F00\u59CB\uFF0C\u8BF7\u7CFB\u597D\u5B89\u5168\u5E26\uFF0C\u4FDD\u7BA1\u597D\u968F\u8EAB\u7269\u54C1\u3002";
  const SMS_FINISH_PREFIX = "\u60A8\u7684\u4EE3\u9A7E\u670D\u52A1\u5DF2\u5B8C\u6210\uFF0C";
  const SMS_FINISH_SUFFIX = "\u611F\u8C22\u60A8\u7684\u9009\u62E9\uFF0C\u671F\u5F85\u4E0B\u6B21\u518D\u89C1\u3002";
  const SMS_CONFIG_DEFAULT = {
    startEnabled: true,
    finishEnabled: true,
    start: { baseFee: true, startTime: true },
    finish: { amount: true, distance: true, waiting: false }
  };
  function sanitizeSmsServiceConfig(input) {
    const src = input && typeof input === "object" ? input : {};
    const boolOr = (v, dflt) => typeof v === "boolean" ? v : dflt;
    const s = src.start && typeof src.start === "object" ? src.start : {};
    const f = src.finish && typeof src.finish === "object" ? src.finish : {};
    return {
      startEnabled: boolOr(src.startEnabled, SMS_CONFIG_DEFAULT.startEnabled),
      finishEnabled: boolOr(src.finishEnabled, SMS_CONFIG_DEFAULT.finishEnabled),
      start: {
        baseFee: boolOr(s.baseFee, SMS_CONFIG_DEFAULT.start.baseFee),
        startTime: boolOr(s.startTime, SMS_CONFIG_DEFAULT.start.startTime)
      },
      finish: {
        amount: boolOr(f.amount, SMS_CONFIG_DEFAULT.finish.amount),
        distance: boolOr(f.distance, SMS_CONFIG_DEFAULT.finish.distance),
        waiting: boolOr(f.waiting, SMS_CONFIG_DEFAULT.finish.waiting)
      }
    };
  }
  const WALLET_CONFIG_SEED = { rechargeAmounts: [10, 20, 50, 100], smsPriceCents: 15 };
  let _walletCfgCache = { at: 0, cfg: { rechargeAmounts: [], smsPriceCents: 0 } };
  function sanitizeWalletConfig(input) {
    if (!input || typeof input !== "object") return null;
    const rawAmounts = Array.isArray(input.rechargeAmounts) ? input.rechargeAmounts : null;
    if (!rawAmounts || rawAmounts.length < 1 || rawAmounts.length > 8) return null;
    const seen = /* @__PURE__ */ new Set();
    const amounts = [];
    for (const raw of rawAmounts) {
      const v = Math.round(Number(raw) * 100) / 100;
      if (!Number.isFinite(v) || v < 1 || v > 1e4 || seen.has(Math.round(v * 100))) return null;
      seen.add(Math.round(v * 100));
      amounts.push(v);
    }
    const price = Number(input.smsPriceCents);
    if (!Number.isInteger(price) || price < 1 || price > 1e3) return null;
    return { rechargeAmounts: amounts, smsPriceCents: price };
  }
  async function writeWalletConfig(cfg) {
    const docObj = { ...cfg, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["config", "wallet_config", JSON.stringify(docObj)]
      );
    }
    try {
      const dbData = readLocalJsonDb();
      if (!dbData["config"]) dbData["config"] = {};
      dbData["config"]["wallet_config"] = docObj;
      writeLocalJsonDb(dbData);
    } catch (_) {
    }
    _walletCfgCache = { at: Date.now(), cfg };
  }
  async function getWalletConfig() {
    if (_walletCfgCache.cfg.rechargeAmounts.length && Date.now() - _walletCfgCache.at < 15e3) {
      return _walletCfgCache.cfg;
    }
    let cfg = null;
    try {
      const doc = await readCanonicalDocument("config", "wallet_config");
      if (doc) cfg = sanitizeWalletConfig(doc);
    } catch (_) {
    }
    if (!cfg) {
      cfg = { rechargeAmounts: [...WALLET_CONFIG_SEED.rechargeAmounts], smsPriceCents: WALLET_CONFIG_SEED.smsPriceCents };
      try {
        await writeWalletConfig(cfg);
      } catch (e) {
        console.error("[WalletConfig] \u79CD\u5B50\u914D\u7F6E\u843D\u76D8\u5931\u8D25:", e?.message || e);
      }
    }
    _walletCfgCache = { at: Date.now(), cfg };
    return cfg;
  }
  async function upsertDocStrict(collection, docId, data) {
    if (isMySQLEnabled && mysqlPool) {
      const upsertSql = "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)";
      const upsertArgs = [collection, docId, JSON.stringify(data)];
      let ok = false;
      let lastErr = null;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          await mysqlPool.query(upsertSql, upsertArgs);
          ok = true;
        } catch (e) {
          lastErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
      if (!ok) throw new Error(`MySQL \u5199\u5165\u5931\u8D25(${collection}/${docId})\uFF1A${lastErr?.message || lastErr}`);
    }
    try {
      const dbData = readLocalJsonDb();
      if (!dbData[collection]) dbData[collection] = {};
      dbData[collection][docId] = data;
      writeLocalJsonDb(dbData, true);
    } catch (_) {
    }
  }
  async function readWalletDoc(phone) {
    const raw = await Promise.resolve(readCanonicalDocument("driver_wallets", phone)).catch(() => null);
    const doc = raw && typeof raw === "object" ? raw : {};
    return {
      phone,
      balanceCents: Math.max(0, Math.round(Number(doc.balanceCents) || 0)),
      logs: Array.isArray(doc.logs) ? doc.logs.slice(0, 200) : [],
      smsConfig: sanitizeSmsServiceConfig(doc.smsConfig),
      updatedAt: doc.updatedAt || ""
    };
  }
  async function saveWalletDoc(wdoc) {
    wdoc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    wdoc.logs = Array.isArray(wdoc.logs) ? wdoc.logs.slice(0, 200) : [];
    await upsertDocStrict("driver_wallets", wdoc.phone, wdoc);
  }
  function pushWalletLog(wdoc, entry) {
    const id = entry.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    wdoc.logs = [{ id, at: (/* @__PURE__ */ new Date()).toISOString(), ...entry }, ...Array.isArray(wdoc.logs) ? wdoc.logs : []].slice(0, 200);
    return id;
  }
  function fmtMoneyShort(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? String(v) : String(v);
  }
  function composeSmsDetail(scene, cfg, f) {
    const MAX = 35;
    const render = (ps) => ps.map((p) => p.text).join("\uFF1B");
    const fit = (parts, dropOrder, punct, fallback) => {
      let ps = parts;
      while (ps.length > 1) {
        const cur = render(ps);
        if (cur.length <= MAX - 1) return cur + punct;
        if (cur.length <= MAX) return cur;
        const dropKey = dropOrder.find((k) => ps.some((p) => p.key === k));
        if (!dropKey) break;
        ps = ps.filter((p) => p.key !== dropKey);
      }
      return ps.length ? render(ps).slice(0, MAX) : fallback;
    };
    if (scene === "start") {
      const all2 = [];
      if (cfg.start.baseFee && f.baseFee > 0) all2.push({ key: "baseFee", text: `\u8D77\u6B65\u8D39\uFF1A${fmtMoneyShort(f.baseFee)}\u5143` });
      if (cfg.start.startTime && f.startTime) all2.push({ key: "startTime", text: `\u5F00\u59CB\u65F6\u95F4\uFF1A${f.startTime}` });
      if (!all2.length) return "\u795D\u60A8\u4E00\u8DEF\u5E73\u5B89\u3002";
      return fit(all2, ["startTime", "baseFee"], "\u3002", "\u795D\u60A8\u4E00\u8DEF\u5E73\u5B89\u3002");
    }
    const all = [];
    if (cfg.finish.amount && f.amount > 0) all.push({ key: "amount", text: `\u91D1\u989D\uFF1A${fmtMoneyShort(f.amount)}\u5143` });
    if (cfg.finish.distance && f.distanceKm > 0) all.push({ key: "distance", text: `\u91CC\u7A0B\uFF1A${fmtMoneyShort(Math.round(f.distanceKm * 100) / 100)}\u516C\u91CC` });
    if (cfg.finish.waiting && f.waitingMin > 0) all.push({ key: "waiting", text: `\u7B49\u5019\u65F6\u95F4\uFF1A${f.waitingMin}\u5206\u949F` });
    if (!all.length) return "\u795D\u60A8\u4E00\u8DEF\u5E73\u5B89\uFF0C";
    return fit(all, ["waiting", "distance"], "\uFF1B", "\u795D\u60A8\u4E00\u8DEF\u5E73\u5B89\uFF0C");
  }
  function buildServiceSmsText(scene, detail) {
    const body = scene === "start" ? SMS_START_BODY + detail : SMS_FINISH_PREFIX + detail + SMS_FINISH_SUFFIX;
    return `\u3010${SMS_SERVICE_SIGN_NAME}\u3011` + body;
  }
  function smsSegments(text) {
    const n = text.length;
    if (n <= 70) return 1;
    return 1 + Math.ceil((n - 70) / 67);
  }
  async function sendServiceSmsDysms(phoneNumbers, templateCode, detail) {
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    if (!accessKeyId || !accessKeySecret) return { ok: false, msg: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u963F\u91CC\u4E91 AccessKey" };
    try {
      const Core = await import("@alicloud/pop-core");
      const PopClient = Core.default || Core;
      const popClient = new PopClient({
        accessKeyId,
        accessKeySecret,
        endpoint: "https://dysmsapi.aliyuncs.com",
        apiVersion: "2017-05-25"
      });
      const popRes = await popClient.request("SendSms", {
        PhoneNumbers: phoneNumbers,
        SignName: SMS_SERVICE_SIGN_NAME,
        TemplateCode: templateCode,
        TemplateParam: JSON.stringify({ detail })
      }, { method: "POST", formatType: "json" });
      if (popRes && (popRes.Code === "OK" || popRes.code === "OK")) {
        return { ok: true, bizId: String(popRes.BizId || popRes.bizId || "") };
      }
      return { ok: false, msg: String(popRes?.Message || popRes?.message || popRes?.Code || "\u963F\u91CC\u4E91\u77ED\u4FE1\u53D1\u9001\u5931\u8D25") };
    } catch (e) {
      return { ok: false, msg: e?.message || "\u77ED\u4FE1\u53D1\u9001\u5F02\u5E38" };
    }
  }
  app.get("/api/shop/wallet-config", async (req, res) => {
    try {
      const cfg = await getWalletConfig();
      return res.json({ ok: true, rechargeAmounts: cfg.rechargeAmounts, smsPriceCents: cfg.smsPriceCents, signName: SMS_SERVICE_SIGN_NAME });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u8BFB\u53D6\u94B1\u5305\u914D\u7F6E\u5931\u8D25" });
    }
  });
  app.post("/api/admin/wallet-config", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ ok: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const cfg = sanitizeWalletConfig(req.body);
      if (!cfg) {
        return res.status(400).json({ ok: false, error: "\u914D\u7F6E\u65E0\u6548\uFF1A\u6863\u4F4D\u9700 1-8 \u4E2A 1~10000 \u5143\u4E0D\u91CD\u590D\u91D1\u989D\u3001\u5355\u4EF7 1~1000 \u5206" });
      }
      await writeWalletConfig(cfg);
      await logAdminOperation("update-wallet-config", String(req.authPhone || ""), "", `\u94B1\u5305\u914D\u7F6E\u66F4\u65B0\uFF1A\u6863\u4F4D ${cfg.rechargeAmounts.join("/")} \u5143\uFF0C\u77ED\u4FE1\u5355\u4EF7 ${cfg.smsPriceCents} \u5206/\u6BB5`, req).catch(() => {
      });
      return res.json({ ok: true, ...cfg });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u4FDD\u5B58\u94B1\u5305\u914D\u7F6E\u5931\u8D25" });
    }
  });
  app.get("/api/wallet/me", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(403).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\u6CA1\u6709\u77ED\u4FE1\u94B1\u5305" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u767B\u5F55\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const wdoc = await readWalletDoc(phone);
      const cfg = await getWalletConfig();
      return res.json({
        ok: true,
        balanceCents: wdoc.balanceCents,
        logs: (wdoc.logs || []).slice(0, 50),
        smsConfig: wdoc.smsConfig,
        rechargeAmounts: cfg.rechargeAmounts,
        smsPriceCents: cfg.smsPriceCents,
        signName: SMS_SERVICE_SIGN_NAME,
        templatesReady: !!(String(process.env.SMS_SERVICE_START_TEMPLATE_CODE || "").trim() && String(process.env.SMS_SERVICE_FINISH_TEMPLATE_CODE || "").trim())
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u8BFB\u53D6\u94B1\u5305\u5931\u8D25" });
    }
  });
  app.post("/api/wallet/sms-config", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(403).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\u6CA1\u6709\u77ED\u4FE1\u94B1\u5305" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u767B\u5F55\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const release = await acquireOrderLock(`wallet:${phone}`);
      try {
        const wdoc = await readWalletDoc(phone);
        wdoc.smsConfig = sanitizeSmsServiceConfig(req.body?.config);
        await saveWalletDoc(wdoc);
        return res.json({ ok: true, smsConfig: wdoc.smsConfig });
      } finally {
        release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u4FDD\u5B58\u77ED\u4FE1\u914D\u7F6E\u5931\u8D25" });
    }
  });
  app.post("/api/pay/alipay/create-recharge-order", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(400).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u80FD\u5145\u503C\u77ED\u4FE1\u4F59\u989D" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u767B\u5F55\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const cfg = await getWalletConfig();
      const amountCents = Math.round(Number(req.body?.amount) * 100);
      const amount = cfg.rechargeAmounts.find((a) => Math.round(a * 100) === amountCents);
      if (!amount) {
        return res.status(400).json({ ok: false, error: "\u5145\u503C\u91D1\u989D\u4E0D\u5728\u53EF\u9009\u6863\u4F4D\u5185" });
      }
      const ali = getAlipayConfig();
      if (!ali.privateKey) {
        return res.status(500).json({ ok: false, error: "alipay_not_configured", message: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u652F\u4ED8\u5B9D\u79C1\u94A5\uFF08ALIPAY_PRIVATE_KEY\uFF09" });
      }
      const outTradeNo = `WAL${Date.now()}${phone.slice(-4)}${import_crypto.default.randomBytes(3).toString("hex").toUpperCase()}`;
      const order = {
        id: outTradeNo,
        outTradeNo,
        type: "wallet",
        phone,
        amount,
        status: "pending",
        tradeNo: "",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writePayOrderDoc(order);
      const bizContent = JSON.stringify({
        subject: `\u9ED1\u6E7E\u4EE3\u9A7EMAX\u77ED\u4FE1\u4F59\u989D\u5145\u503C${fmtMoneyShort(amount)}\u5143`,
        out_trade_no: outTradeNo,
        total_amount: amount.toFixed(2),
        product_code: "QUICK_MSECURITY_PAY",
        timeout_express: "30m"
      });
      const ts = /* @__PURE__ */ new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const params = {
        app_id: ali.appId,
        method: "alipay.trade.app.pay",
        charset: "utf-8",
        sign_type: "RSA2",
        timestamp: `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`,
        version: "1.0",
        notify_url: ali.notifyUrl,
        biz_content: bizContent
      };
      const signer = import_crypto.default.createSign("RSA-SHA256");
      signer.update(alipaySignContent(params, false), "utf8");
      const sign = signer.sign(ali.privateKey, "base64");
      const orderString = [...Object.keys(params).sort(), "sign"].map((k) => `${k}=${encodeURIComponent(k === "sign" ? sign : params[k])}`).join("&");
      console.log(`[Alipay RechargeOrder] phone=${phone} amount=${amount} outTradeNo=${outTradeNo}`);
      return res.json({ ok: true, outTradeNo, orderString });
    } catch (e) {
      console.error("[Alipay RechargeOrder Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u521B\u5EFA\u5145\u503C\u8BA2\u5355\u5931\u8D25" });
    }
  });
  app.post("/api/sms/service-notify", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "");
      if (hasMerchantASuffix(authPhone)) {
        return res.status(400).json({ ok: false, error: "\u5546\u6237\u8D26\u53F7\u4E0D\u80FD\u53D1\u9001\u670D\u52A1\u77ED\u4FE1" });
      }
      const phone = authPhone.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u767B\u5F55\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const scene = req.body?.scene === "finish" ? "finish" : req.body?.scene === "start" ? "start" : null;
      if (!scene) {
        return res.status(400).json({ ok: false, error: "scene \u65E0\u6548" });
      }
      const orderId = String(req.body?.orderId || "").replace(/[^\w-]/g, "").slice(0, 64);
      if (!orderId) {
        return res.status(400).json({ ok: false, error: "\u7F3A\u5C11 orderId" });
      }
      const passengerPhone = String(req.body?.passengerPhone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(passengerPhone)) {
        return res.json({ ok: false, skipped: "no_passenger_phone" });
      }
      if (passengerPhone === phone) {
        return res.json({ ok: false, skipped: "self_phone" });
      }
      const numField = (v, max) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(n, max);
      };
      const rawFields = req.body?.fields && typeof req.body.fields === "object" ? req.body.fields : {};
      const startTimeRaw = String(rawFields.startTime || "").trim();
      const fields = {
        baseFee: numField(rawFields.baseFee, 1e5),
        amount: numField(rawFields.amount, 1e5),
        distanceKm: numField(rawFields.distanceKm, 1e5),
        waitingMin: Math.round(numField(rawFields.waitingMin, 1e5)),
        startTime: /^\d{1,2}:\d{2}$/.test(startTimeRaw) ? startTimeRaw : "",
        orderNo: String(rawFields.orderNo || "").replace(/[^\w-]/g, "").slice(0, 24)
      };
      const vipExpiry = await readDriverVipExpiry(phone);
      if (!isVipActiveServer(vipExpiry)) {
        return res.json({ ok: false, skipped: "not_vip" });
      }
      const templateCode = String((scene === "start" ? process.env.SMS_SERVICE_START_TEMPLATE_CODE : process.env.SMS_SERVICE_FINISH_TEMPLATE_CODE) || "").trim();
      if (!templateCode) {
        return res.json({ ok: false, skipped: "template_not_configured", error: "sms_template_not_configured" });
      }
      const walletCfg = await getWalletConfig();
      const logKey = `${orderId}_${scene}`;
      const release = await acquireOrderLock(`wallet:${phone}`);
      try {
        const prior = await Promise.resolve(readCanonicalDocument("sms_service_logs", logKey)).catch(() => null);
        if (prior && prior.status === "sent") {
          return res.json({ ok: true, alreadySent: true, chargedCents: Number(prior.chargedCents) || 0 });
        }
        const wdoc = await readWalletDoc(phone);
        const cfg = wdoc.smsConfig;
        if (scene === "start" && !cfg.startEnabled) return res.json({ ok: false, skipped: "scene_disabled" });
        if (scene === "finish" && !cfg.finishEnabled) return res.json({ ok: false, skipped: "scene_disabled" });
        const detail = composeSmsDetail(scene, cfg, fields);
        const fullText = buildServiceSmsText(scene, detail);
        const segments = smsSegments(fullText);
        const cost = segments * walletCfg.smsPriceCents;
        if (wdoc.balanceCents < cost) {
          return res.json({ ok: false, skipped: "insufficient_balance", balanceCents: wdoc.balanceCents, needCents: cost });
        }
        wdoc.balanceCents -= cost;
        const chargeLogId = pushWalletLog(wdoc, {
          type: "sms_charge",
          amountCents: -cost,
          balanceAfterCents: wdoc.balanceCents,
          scene,
          orderId,
          segments,
          status: "sending",
          note: scene === "start" ? "\u5F00\u59CB\u670D\u52A1\u77ED\u4FE1" : "\u5B8C\u6210\u670D\u52A1\u77ED\u4FE1"
        });
        await saveWalletDoc(wdoc);
        const sendRes = await sendServiceSmsDysms(passengerPhone, templateCode, detail);
        if (sendRes.ok) {
          const w2 = await readWalletDoc(phone);
          const lg = (w2.logs || []).find((l) => l.id === chargeLogId);
          if (lg) {
            lg.status = "sent";
            lg.bizId = sendRes.bizId || "";
          }
          await saveWalletDoc(w2).catch(() => {
          });
          await upsertDocStrict("sms_service_logs", logKey, {
            phone,
            orderId,
            scene,
            status: "sent",
            chargedCents: cost,
            segments,
            bizId: sendRes.bizId || "",
            passengerPhone,
            detail,
            at: (/* @__PURE__ */ new Date()).toISOString()
          }).catch(() => {
          });
          console.log(`[ServiceSms] sent phone=${phone} scene=${scene} order=${orderId} segments=${segments} cost=${cost}`);
          return res.json({ ok: true, chargedCents: cost, segments, balanceCents: w2.balanceCents });
        }
        const w3 = await readWalletDoc(phone);
        w3.balanceCents += cost;
        const lg3 = (w3.logs || []).find((l) => l.id === chargeLogId);
        if (lg3) lg3.status = "refunded";
        pushWalletLog(w3, {
          type: "sms_refund",
          amountCents: cost,
          balanceAfterCents: w3.balanceCents,
          scene,
          orderId,
          note: "\u77ED\u4FE1\u53D1\u9001\u5931\u8D25\u81EA\u52A8\u9000\u56DE"
        });
        await saveWalletDoc(w3).catch(() => {
        });
        await upsertDocStrict("sms_service_logs", logKey, {
          phone,
          orderId,
          scene,
          status: "failed",
          error: sendRes.msg || "",
          passengerPhone,
          at: (/* @__PURE__ */ new Date()).toISOString()
        }).catch(() => {
        });
        console.warn(`[ServiceSms] send failed phone=${phone} scene=${scene} order=${orderId}: ${sendRes.msg}`);
        return res.json({ ok: false, error: "sms_send_failed", message: sendRes.msg || "\u77ED\u4FE1\u53D1\u9001\u5931\u8D25" });
      } finally {
        release();
      }
    } catch (e) {
      console.error("[ServiceSms Error]:", e);
      return res.status(500).json({ ok: false, error: e?.message || "\u670D\u52A1\u77ED\u4FE1\u5904\u7406\u5931\u8D25" });
    }
  });
  app.get("/api/admin/wallet", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ ok: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const phone = String(req.query.phone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const wdoc = await readWalletDoc(phone);
      return res.json({ ok: true, phone, balanceCents: wdoc.balanceCents, logs: (wdoc.logs || []).slice(0, 100), smsConfig: wdoc.smsConfig });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u67E5\u8BE2\u94B1\u5305\u5931\u8D25" });
    }
  });
  app.post("/api/admin/wallet/adjust", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ ok: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    try {
      const phone = String(req.body?.phone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: "\u624B\u673A\u53F7\u65E0\u6548" });
      }
      const amountCents = Math.round(Number(req.body?.amountYuan) * 100);
      if (!Number.isFinite(amountCents) || amountCents === 0 || Math.abs(amountCents) > 1e7) {
        return res.status(400).json({ ok: false, error: "\u8C03\u6574\u91D1\u989D\u65E0\u6548\uFF08\u5355\u4F4D\u5143\uFF0C\u975E 0\uFF0C\xB1100000 \u5185\uFF09" });
      }
      const note = String(req.body?.note || "").slice(0, 100);
      const release = await acquireOrderLock(`wallet:${phone}`);
      try {
        const wdoc = await readWalletDoc(phone);
        if (wdoc.balanceCents + amountCents < 0) {
          return res.status(400).json({ ok: false, error: "\u8C03\u6574\u540E\u4F59\u989D\u4E0D\u80FD\u4E3A\u8D1F" });
        }
        wdoc.balanceCents += amountCents;
        pushWalletLog(wdoc, {
          type: "admin_adjust",
          amountCents,
          balanceAfterCents: wdoc.balanceCents,
          note: note || "\u7BA1\u7406\u540E\u53F0\u624B\u52A8\u8C03\u6574"
        });
        await saveWalletDoc(wdoc);
        await logAdminOperation("wallet-adjust", String(req.authPhone || ""), phone, `\u77ED\u4FE1\u94B1\u5305\u4F59\u989D\u8C03\u6574 ${amountCents > 0 ? "+" : ""}${fmtMoneyShort(amountCents / 100)} \u5143\uFF0C\u4F59\u989D ${fmtMoneyShort(wdoc.balanceCents / 100)} \u5143${note ? "\uFF08" + note + "\uFF09" : ""}`, req).catch(() => {
        });
        return res.json({ ok: true, phone, balanceCents: wdoc.balanceCents });
      } finally {
        release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "\u8C03\u6574\u4F59\u989D\u5931\u8D25" });
    }
  });
  const APP_DOWNLOADS_DIR = import_path.default.resolve(process.cwd(), "downloads");
  let _appUpdateCfgCache = { at: 0, cfg: null };
  async function getAppUpdateConfig() {
    if (_appUpdateCfgCache.cfg && Date.now() - _appUpdateCfgCache.at < 15e3) return _appUpdateCfgCache.cfg;
    let cfg = {};
    try {
      const doc = await readCanonicalDocument("config", "app_update");
      if (doc && typeof doc === "object") cfg = doc;
    } catch (_) {
    }
    _appUpdateCfgCache = { at: Date.now(), cfg };
    return cfg;
  }
  async function writeAppUpdateConfig(cfg) {
    const dataStr = JSON.stringify(cfg);
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
        ["config", "app_update", dataStr]
      );
    }
    try {
      const dbData = readLocalJsonDb();
      if (!dbData["config"]) dbData["config"] = {};
      dbData["config"]["app_update"] = cfg;
      writeLocalJsonDb(dbData);
    } catch (_) {
    }
    _appUpdateCfgCache = { at: Date.now(), cfg };
  }
  let _dlSecretCache = "";
  async function getDownloadSecret() {
    if (_dlSecretCache) return _dlSecretCache;
    try {
      const cfgDoc = await readCanonicalDocument("config", "_config");
      if (cfgDoc && cfgDoc.tokenSecret) {
        _dlSecretCache = String(cfgDoc.tokenSecret);
        return _dlSecretCache;
      }
    } catch (_) {
    }
    _dlSecretCache = "dl-" + import_crypto.default.randomBytes(24).toString("hex");
    return _dlSecretCache;
  }
  function appDownloadSig(secret, platform, file, exp) {
    return import_crypto.default.createHmac("sha256", secret).update(`${platform}.${file}.${exp}`).digest("hex");
  }
  function appRolloutHit(phone, rollout) {
    if (rollout >= 100) return true;
    if (rollout <= 0) return false;
    const h = import_crypto.default.createHash("md5").update(phone || "anon").digest("hex");
    return parseInt(h.slice(0, 6), 16) % 100 < rollout;
  }
  app.get("/api/app/version", async (req, res) => {
    try {
      const platform = req.query.platform === "ios" ? "ios" : "android";
      const clientBuild = parseInt(String(req.query.build || "0"), 10) || 0;
      const phone = String(req.query.phone || "").replace(/\D/g, "").trim();
      const all = await getAppUpdateConfig();
      const cfg = all && typeof all[platform] === "object" ? all[platform] : null;
      const latestBuild = cfg ? parseInt(String(cfg.build || "0"), 10) || 0 : 0;
      const rollout = cfg && cfg.rollout !== void 0 ? Math.max(0, Math.min(100, Number(cfg.rollout))) : 100;
      const hit = cfg ? appRolloutHit(phone, rollout) : false;
      const hasUpdate = !!(cfg && cfg.file && latestBuild > clientBuild && hit);
      const out = {
        success: true,
        serverTime: Date.now(),
        platform,
        latestBuild,
        currentBuild: clientBuild,
        hasUpdate,
        force: !!(cfg && cfg.force),
        name: cfg?.name || "",
        notes: cfg?.notes || "",
        size: cfg?.size || 0,
        sha256: cfg?.sha256 || "",
        publishedAt: cfg?.publishedAt || 0
      };
      if (hasUpdate) {
        const exp = Date.now() + 3600 * 1e3;
        const secret = await getDownloadSecret();
        out.downloadUrl = `/api/app/download?platform=${platform}&exp=${exp}&sig=${appDownloadSig(secret, platform, String(cfg.file), exp)}`;
        out.downloadExp = exp;
      }
      if (phone && (phone.length === 11 || phone.length === 12)) {
        (async () => {
          try {
            const prev = await readCanonicalDocument("app_version_reports", phone);
            if (!prev || Number(prev.build || 0) !== clientBuild || Date.now() - Number(prev.updatedAt || 0) > 6 * 3600 * 1e3) {
              const rep = { phone, build: clientBuild, platform, updatedAt: Date.now() };
              if (isMySQLEnabled && mysqlPool) {
                await mysqlPool.query(
                  "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                  ["app_version_reports", phone, JSON.stringify(rep)]
                ).catch(() => {
                });
              }
              try {
                const dbData = readLocalJsonDb();
                if (!dbData["app_version_reports"]) dbData["app_version_reports"] = {};
                dbData["app_version_reports"][phone] = rep;
                writeLocalJsonDb(dbData);
              } catch (_) {
              }
            }
          } catch (_) {
          }
        })();
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ success: false, error: e?.message || "version check failed" });
    }
  });
  let _appDlActive = 0;
  const APP_DL_MAX_CONCURRENT = 6;
  app.get("/api/app/download", async (req, res) => {
    try {
      const platform = req.query.platform === "ios" ? "ios" : "android";
      const exp = parseInt(String(req.query.exp || "0"), 10) || 0;
      const sig = String(req.query.sig || "");
      if (!exp || exp < Date.now()) return res.status(403).json({ success: false, error: "\u4E0B\u8F7D\u94FE\u63A5\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728App\u5185\u91CD\u65B0\u83B7\u53D6" });
      const all = await getAppUpdateConfig();
      const cfg = all && typeof all[platform] === "object" ? all[platform] : null;
      if (!cfg || !cfg.file) return res.status(404).json({ success: false, error: "\u6682\u65E0\u5B89\u88C5\u5305" });
      const secret = await getDownloadSecret();
      const expect = appDownloadSig(secret, platform, String(cfg.file), exp);
      if (sig !== expect) return res.status(403).json({ success: false, error: "\u4E0B\u8F7D\u94FE\u63A5\u65E0\u6548" });
      const fileName = import_path.default.basename(String(cfg.file));
      const filePath = import_path.default.join(APP_DOWNLOADS_DIR, fileName);
      let stat = null;
      try {
        stat = await import_fs.default.promises.stat(filePath);
      } catch (_) {
      }
      if (!stat || !stat.isFile()) return res.status(404).json({ success: false, error: "\u5B89\u88C5\u5305\u6587\u4EF6\u4E0D\u5B58\u5728" });
      if (_appDlActive >= APP_DL_MAX_CONCURRENT) {
        res.setHeader("Retry-After", "20");
        return res.status(503).json({ success: false, error: "\u4E0B\u8F7D\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" });
      }
      _appDlActive++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          _appDlActive = Math.max(0, _appDlActive - 1);
        }
      };
      res.on("close", release);
      const total = stat.size;
      let start = 0;
      let end = total - 1;
      let status = 200;
      const range = String(req.headers.range || "");
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        if (m[1]) start = parseInt(m[1], 10);
        if (m[2]) end = parseInt(m[2], 10);
        if (isNaN(start) || isNaN(end) || start > end || start >= total) {
          release();
          res.setHeader("Content-Range", `bytes */${total}`);
          return res.status(416).end();
        }
        end = Math.min(end, total - 1);
        status = 206;
      }
      res.status(status);
      res.setHeader("Content-Type", platform === "ios" ? "application/octet-stream" : "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(end - start + 1));
      if (status === 206) res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      const stream = import_fs.default.createReadStream(filePath, { start, end });
      stream.on("error", () => {
        release();
        try {
          res.end();
        } catch (_) {
        }
      });
      stream.pipe(res);
    } catch (e) {
      try {
        res.status(500).json({ success: false, error: e?.message || "download failed" });
      } catch (_) {
      }
    }
  });
  app.get("/api/admin/app-version", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    try {
      const cfg = await getAppUpdateConfig();
      let files = [];
      try {
        const names = await import_fs.default.promises.readdir(APP_DOWNLOADS_DIR);
        for (const n of names) {
          try {
            const st = await import_fs.default.promises.stat(import_path.default.join(APP_DOWNLOADS_DIR, n));
            if (st.isFile()) files.push({ file: n, size: st.size, mtime: st.mtimeMs });
          } catch (_) {
          }
        }
      } catch (_) {
      }
      files.sort((a, b) => b.mtime - a.mtime);
      res.json({ success: true, config: cfg || {}, files, downloadsDir: "downloads/" });
    } catch (e) {
      res.status(500).json({ success: false, error: e?.message || "read failed" });
    }
  });
  app.post("/api/admin/app-version", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    try {
      const platform = req.body?.platform === "ios" ? "ios" : "android";
      const all = await getAppUpdateConfig();
      const cur = all && typeof all[platform] === "object" ? { ...all[platform] } : {};
      const body = req.body || {};
      if (body.file !== void 0) {
        const fileName = import_path.default.basename(String(body.file || ""));
        const filePath = import_path.default.join(APP_DOWNLOADS_DIR, fileName);
        let stat = null;
        try {
          stat = await import_fs.default.promises.stat(filePath);
        } catch (_) {
        }
        if (!fileName || !stat || !stat.isFile()) {
          return res.status(400).json({ success: false, error: `\u5B89\u88C5\u5305\u6587\u4EF6\u4E0D\u5B58\u5728\u4E8E downloads/ \u76EE\u5F55\uFF1A${fileName || "(\u7A7A)"}` });
        }
        const hash = import_crypto.default.createHash("sha256");
        await new Promise((resolve, reject) => {
          const s = import_fs.default.createReadStream(filePath);
          s.on("data", (c) => hash.update(c));
          s.on("end", () => resolve());
          s.on("error", reject);
        });
        cur.file = fileName;
        cur.sha256 = hash.digest("hex");
        cur.size = stat.size;
      }
      if (body.build !== void 0) {
        const b = parseInt(String(body.build), 10);
        if (!b || b <= 0) return res.status(400).json({ success: false, error: "\u6784\u5EFA\u53F7\u5FC5\u987B\u662F\u6B63\u6574\u6570" });
        cur.build = b;
      }
      if (body.name !== void 0) cur.name = String(body.name).slice(0, 60);
      if (body.notes !== void 0) cur.notes = String(body.notes).slice(0, 500);
      if (body.force !== void 0) cur.force = !!body.force;
      if (body.rollout !== void 0) cur.rollout = Math.max(0, Math.min(100, Number(body.rollout) || 0));
      if (!cur.file || !cur.build) return res.status(400).json({ success: false, error: "\u8BF7\u5148\u6307\u5B9A\u5B89\u88C5\u5305\u6587\u4EF6\u4E0E\u6784\u5EFA\u53F7" });
      cur.publishedAt = Date.now();
      cur.publishedBy = String(req.authPhone || "");
      const next = { ...all || {}, [platform]: cur };
      await writeAppUpdateConfig(next);
      await logAdminOperation("app_version_publish", String(req.authPhone || ""), "", `${platform} \u53D1\u5E03\u6784\u5EFA ${cur.build}\uFF08${cur.file}\uFF0C\u5F3A\u5236=${cur.force ? "\u5F00" : "\u5173"}\uFF0C\u7070\u5EA6=${cur.rollout ?? 100}%\uFF09`, req);
      res.json({ success: true, config: next });
    } catch (e) {
      res.status(500).json({ success: false, error: e?.message || "publish failed" });
    }
  });
  app.get("/api/admin/app-version-reports", requireDbAuth, async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    try {
      const map = /* @__PURE__ */ new Map();
      try {
        const local = readLocalJsonDb()?.["app_version_reports"] || {};
        Object.values(local).forEach((v) => {
          if (v && v.phone) map.set(String(v.phone), v);
        });
      } catch (_) {
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["app_version_reports"]
          );
          (rows || []).forEach((r) => {
            const d = typeof r.data === "string" ? parseStoredDoc(r.data) : r.data;
            if (d && d.phone) map.set(String(d.phone), d);
          });
        } catch (_) {
        }
      }
      res.json({ success: true, list: Array.from(map.values()).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)) });
    } catch (e) {
      res.status(500).json({ success: false, error: e?.message || "reports failed" });
    }
  });
  let _guard0559Running = false;
  setInterval(async () => {
    if (_guard0559Running) return;
    _guard0559Running = true;
    try {
      const now = /* @__PURE__ */ new Date();
      const beijingMs = now.getTime() + now.getTimezoneOffset() * 6e4 + 8 * 36e5;
      const beijingDate = new Date(beijingMs);
      const hours = beijingDate.getHours();
      const minutes = beijingDate.getMinutes();
      const is0559Time = hours === 5 && minutes === 59;
      const cutoffMs = getMostRecent0559CutoffMs();
      const dbData = readLocalJsonDb();
      const driverUsers = dbData.driver_users || {};
      const squadMembers = dbData.squad_members || {};
      const driverLocations = dbData.driver_locations || {};
      const merchantOrders = await loadMerchantOrdersCanonical();
      const onlineDriverPhones = /* @__PURE__ */ new Set();
      Object.keys(driverUsers).forEach((phone) => {
        if (driverUsers[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      Object.keys(squadMembers).forEach((phone) => {
        if (squadMembers[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      Object.keys(driverLocations).forEach((phone) => {
        if (driverLocations[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      if (onlineDriverPhones.size === 0 && pendingOfflineDrivers.size === 0) {
        return;
      }
      const hasActiveOrder = (phone) => {
        const cleanPhone = String(phone).trim();
        for (const [, order] of merchantOrders) {
          if (!order) continue;
          const assignedDriver = String(order.dispatchedDriverPhone || order.driverPhone || order.assignedDriver || "").trim();
          if (assignedDriver === cleanPhone) {
            const st = String(order.statusCategory || order.status || "").trim();
            if (["submitted", "dispatched", "claimed", "accepted", "taken", "arrived", "serving", "\u5C31\u4F4D", "\u670D\u52A1\u4E2D", "\u5DF2\u63A5\u5355"].includes(st)) {
              return true;
            }
          }
        }
        return false;
      };
      const expiredPhones = [];
      for (const phone of Array.from(onlineDriverPhones)) {
        let driverOnlineTime = 0;
        for (const src of [driverUsers[phone], squadMembers[phone], driverLocations[phone]]) {
          if (!src) continue;
          const t = docLatestTimeMs(src);
          if (t > driverOnlineTime) driverOnlineTime = t;
        }
        const isExpired = is0559Time || (!driverOnlineTime || driverOnlineTime < cutoffMs);
        if (isExpired) {
          if (hasActiveOrder(phone)) {
            if (!pendingOfflineDrivers.has(phone)) {
              pendingOfflineDrivers.set(phone, 0);
            }
          } else if (!pendingOfflineDrivers.has(phone)) {
            expiredPhones.push(phone);
          }
        }
      }
      for (let i = 0; i < expiredPhones.length; i += 50) {
        const chunk = expiredPhones.slice(i, i + 50);
        await Promise.all(chunk.map(
          (phone) => performServerOffline(phone, is0559Time ? "daily_0559_scheduled_idle" : "daily_0559_expired_cutoff").catch(() => {
          })
        ));
      }
      if (pendingOfflineDrivers.size > 0) {
        for (const [phone, finishTimestamp] of Array.from(pendingOfflineDrivers.entries())) {
          const isStillActive = hasActiveOrder(phone);
          if (isStillActive) {
            continue;
          }
          if (finishTimestamp === 0) {
            pendingOfflineDrivers.set(phone, Date.now());
          } else if (Date.now() - finishTimestamp >= 5e3) {
            await performServerOffline(phone, "daily_0559_after_order_5s");
            pendingOfflineDrivers.delete(phone);
          }
        }
      }
    } catch (daemonErr) {
      console.error("[Baota Cron 05:59 Daemon Error]:", daemonErr);
    } finally {
      _guard0559Running = false;
    }
  }, 6e4);
  function calculateHaversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  const YINCHUAN_SERVER_POIS = [];
  const AMAP_KEY_SERVER = process.env.AMAP_KEY_SERVER || "0ae534670da6caccb517c02edd04e89e";
  if (!process.env.AMAP_KEY_SERVER) {
    console.warn("[Security] \u8B66\u544A\uFF1A\u6B63\u5728\u4F7F\u7528\u4EE3\u7801\u5185\u7F6E\u9AD8\u5FB7 Key\uFF0C\u8BF7\u8BBE\u7F6E AMAP_KEY_SERVER \u73AF\u5883\u53D8\u91CF\u5E76\u8F6E\u6362\uFF01");
  }
  if (!process.env.AMAP_KEY_SERVER) {
    console.warn("[Config] AMAP_KEY_SERVER \u672A\u914D\u7F6E\u73AF\u5883\u53D8\u91CF\uFF0C\u4F7F\u7528\u5185\u7F6E\u503C\uFF1B\u8BF7\u5C3D\u5FEB\u5728\u9AD8\u5FB7\u63A7\u5236\u53F0\u8F6E\u6362\u8BE5 Key \u5E76\u914D\u7F6E\u73AF\u5883\u53D8\u91CF");
  }
  async function geocodeServerPoiAsync(startLoc, fallbackLat, fallbackLng, city) {
    const failResult = { lat: NaN, lng: NaN, reliable: false };
    if (!startLoc || typeof startLoc !== "string" || !startLoc.trim()) {
      return failResult;
    }
    const clean = startLoc.trim().replace(/^代驾商家起点[为：:\s]*/g, "").replace(/^商家代叫起点[为：:\s]*/g, "").replace(/^商家起点[为：:\s]*/g, "").replace(/^代叫商家起点[为：:\s]*/g, "").replace(/^代驾起点[为：:\s]*/g, "").replace(/^起点[为：:\s]*/g, "").trim() || startLoc.trim();
    const normCity = (city || "").trim().replace(/市$/, "") + "";
    const cityForApi = normCity ? normCity.endsWith("\u5E02") ? normCity : normCity + "\u5E02" : "";
    for (const poi of YINCHUAN_SERVER_POIS) {
      if (poi.keywords.some((kw) => clean.includes(kw) || kw.includes(clean))) {
        return { lat: poi.lat, lng: poi.lng, reliable: true };
      }
    }
    const queryAmap = async (addr) => {
      try {
        let url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(addr)}&key=${AMAP_KEY_SERVER}`;
        if (cityForApi) {
          url += `&city=${encodeURIComponent(cityForApi)}`;
        }
        const resp = await fetch(url, { signal: AbortSignal.timeout(5e3) });
        const data = await resp.json();
        if (data.status === "1" && data.geocodes?.length > 0) {
          const candidates = data.geocodes;
          let picked = null;
          if (cityForApi && normCity) {
            const cityCore = normCity.replace(/市$/, "");
            picked = candidates.find((g) => {
              const gCity = String(g.city || "");
              const gProv = String(g.province || "");
              return gCity.includes(cityCore) || cityCore.includes(gCity.replace(/市$/, "")) || gProv.includes(cityCore);
            }) || null;
            if (!picked) {
              console.warn(`[Geocode] \u57CE\u5E02\u6821\u9A8C\u5931\u8D25: address=${addr}, \u671F\u671B\u57CE\u5E02=${cityForApi}, \u9AD8\u5FB7\u8FD4\u56DE\u5747\u4E3A\u5916\u5730: ${candidates.slice(0, 3).map((g) => `${g.province}${g.city}`).join(" / ")}`);
              return null;
            }
          } else {
            picked = candidates[0];
          }
          const loc = String(picked.location || "").split(",");
          const lng = Number(loc[0]), lat = Number(loc[1]);
          if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
            console.log(`[Geocode] \u9AD8\u5FB7\u89E3\u6790\u6210\u529F: ${addr} -> ${lat},${lng} (${picked.province}${picked.city}${picked.district})`);
            return { lat, lng, reliable: true };
          }
        }
        console.warn(`[Geocode] \u9AD8\u5FB7\u89E3\u6790\u5931\u8D25: address=${addr}, status=${data.status}, info=${data.info}, infocode=${data.infocode}`);
        if (data.infocode === "10009") {
          console.warn(`[Geocode] Key\u5E73\u53F0\u9650\u5236(USERKEY_PLAT_NOMATCH): \u8BF7\u5728\u9AD8\u5FB7\u63A7\u5236\u53F0\u68C0\u67E5Key\u7684"\u670D\u52A1\u5E73\u53F0"\u8BBE\u7F6E\uFF0C\u670D\u52A1\u7AEF\u8C03\u7528\u9700\u8981"Web\u670D\u52A1"\u7C7B\u578BKey\u6216IP\u767D\u540D\u5355\u5305\u542B\u672C\u670D\u52A1\u5668IP`);
        }
      } catch (e) {
        console.warn("[Geocode] \u9AD8\u5FB7 API \u5F02\u5E38:", e?.message);
      }
      return null;
    };
    const stage1 = await queryAmap(clean);
    if (stage1) return stage1;
    const stripped = clean.replace(/[(（](建设中|装修中|筹备中|试营业|试运营|已闭店|已关闭|暂停营业|装修升级中|内部装修)[)）]\s*$/g, "").replace(/[(（](建设中|装修中|筹备中|试营业|试运营|已闭店|已关闭|暂停营业|装修升级中|内部装修)[)）]/g, "").trim();
    if (stripped && stripped !== clean) {
      console.log(`[Geocode] \u9636\u6BB51\u5931\u8D25\uFF0C\u5265\u79BB\u5907\u6CE8\u540E\u7F00\u540E\u91CD\u8BD5: ${clean} -> ${stripped}`);
      const stage2 = await queryAmap(stripped);
      if (stage2) return stage2;
    }
    console.warn(`[Geocode] \u5750\u6807\u672A\u77E5: ${clean}\uFF0C\u672C\u5730POI\u548C\u9AD8\u5FB7\u5747\u5931\u8D25`);
    return failResult;
  }
  app.get(["/api/geocode", "/api/geo/locate"], requireDbAuth, async (req, res) => {
    try {
      const address = String(req.query.address || req.query.name || req.query.keyword || "").trim();
      const city = String(req.query.city || "").trim();
      const fallbackLat = Number(req.query.lat || req.query.fallbackLat || 38.483);
      const fallbackLng = Number(req.query.lng || req.query.fallbackLng || 106.235);
      const poi = await geocodeServerPoiAsync(address, fallbackLat, fallbackLng, city);
      return res.json({
        success: true,
        address,
        city,
        lat: poi.lat,
        lng: poi.lng,
        reliable: poi.reliable
      });
    } catch (err) {
      return res.json({ success: false, error: err.message, lat: NaN, lng: NaN });
    }
  });
  app.post("/api/dispatch/nearest", requireDbAuth, async (req, res) => {
    try {
      const { orderData, pickupLat, pickupLng } = req.body || {};
      const rawAuthForDispatch = String(req.authPhone || "").trim();
      const authDriverDigits = /a$/i.test(rawAuthForDispatch) ? "" : rawAuthForDispatch.replace(/\D/g, "").trim();
      const reporterPhone = authDriverDigits;
      const excludePhone = authDriverDigits;
      const lockOrderId = String(orderData?.orderId || orderData?.id || orderData?.orderNo || "").trim();
      if (lockOrderId) {
        const lockTs = dispatchOrderLocks.get(lockOrderId) || 0;
        if (Date.now() - lockTs < 6e4) {
          return res.status(409).json({ success: false, error: "\u8BE5\u8BA2\u5355\u6B63\u5728\u6D3E\u5355\u5904\u7406\u4E2D" });
        }
        dispatchOrderLocks.set(lockOrderId, Date.now());
        if (dispatchOrderLocks.size > 500) {
          const cutoff = Date.now() - 6e4;
          for (const [k, v] of dispatchOrderLocks) {
            if (v < cutoff) dispatchOrderLocks.delete(k);
          }
        }
      }
      const radiusKm = Math.min(Number(req.body?.radiusKm) || 3, 3);
      if (orderData && typeof orderData === "object") {
        delete orderData.dispatchedDriverPhone;
        delete orderData.dispatchedDriverName;
        for (const poisonField of [
          "claimedDriverPhone",
          "claimedDriverName",
          "claimedAt",
          "declinedDriverPhones",
          "timeoutDriverPhones",
          "rejectedDriverPhones",
          "coordsUnknown",
          "in_hall",
          "status",
          "statusCategory",
          "isCancelled",
          "hallAt",
          "hallReason",
          // 2026-10-23 第二十五轮：补剥 isCancelled——预置 true 的毒单被接单后会同时是 claimed 与已取消，读 IC 的消费方误判终态
          "dispatchedAt",
          "dispatchExpiresAt",
          "dispatchCountdown",
          "serverCountdown",
          "paymentQrCode",
          "qrCode",
          "wechatQrCode",
          "driverQrCode",
          "qrcode_url",
          "assignedDriver",
          "assignedDriverPhone"
        ]) {
          delete orderData[poisonField];
        }
        orderData.calculatedTotalFee = 40;
        orderData.estimatedPrice = "40.00";
        orderData.price = "\xA540.00";
        delete orderData.fare;
        delete orderData.totalFee;
        for (const textField of [
          "startLocation",
          "endLocation",
          "destination",
          "dropoffName",
          "pickupName",
          "startAddress",
          "endAddress",
          "passengerName",
          "remark",
          "orderRemark",
          "note"
        ]) {
          const v = orderData[textField];
          if (typeof v === "string" && v.length > 300) {
            orderData[textField] = v.slice(0, 300);
          }
        }
        if (!String(orderData.merchantPhone || "").trim()) {
          const placerPhone = String(req.authPhone || "").trim();
          if (placerPhone) orderData.merchantPhone = placerPhone;
        }
      }
      if (!req.isAdmin) {
        const rawAuthPhone = String(req.authPhone || "").trim().toUpperCase();
        if (rawAuthPhone.endsWith("A")) {
        } else {
          const authPhone = rawAuthPhone.replace(/A$/, "");
          const MANAGER_ROLES = ["\u5F00\u53D1\u8005\u53F8\u673A", "\u5F00\u53D1\u8005", "\u603B\u6307\u6325\u5B98", "\u57CE\u5E02\u8001\u677F\u53F8\u673A", "\u57CE\u5E02\u8001\u677F", "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A", "\u57CE\u5E02\u7BA1\u7406", "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A", "\u57CE\u5E02\u6D3E\u5355\u5458"];
          let isManager = false;
          try {
            const mship = await getUnifiedMembership(authPhone);
            const mRole = String(mship?.role || "");
            const mPos = String(mship?.squadPosition || "");
            isManager = !!mship?.isMember && (MANAGER_ROLES.some((r) => mRole.includes(r)) || ["boss", "manager", "dispatcher"].includes(mPos));
          } catch (_) {
          }
          if (!isManager) {
            if (lockOrderId) dispatchOrderLocks.delete(lockOrderId);
            return res.status(403).json({ success: false, error: "\u4EC5\u5C0F\u961F\u7BA1\u7406\u4EBA\u5458\u6216\u5546\u6237\u53EF\u4EE5\u4E0B\u5546\u6237\u4EE3\u53EB\u8BA2\u5355" });
          }
        }
      }
      if (!orderData || !orderData.id && !orderData.orderNo) {
        return res.status(400).json({ success: false, error: "Missing orderData" });
      }
      const startLocName = String(orderData.startLocation || orderData.passengerAddress || orderData.pickupAddress || "").trim();
      let pLat = Number(pickupLat || orderData.passengerLat || orderData.startLat || orderData.lat);
      let pLng = Number(pickupLng || orderData.passengerLng || orderData.startLng || orderData.lng);
      const isDefaultCentroid = isNaN(pLat) || isNaN(pLng) || pLat === 0 || pLng === 0 || Math.abs(pLat - 38.487167) < 1e-3 && Math.abs(pLng - 106.23091) < 1e-3 || Math.abs(pLat - 38.483) < 1e-3 && Math.abs(pLng - 106.235) < 1e-3;
      const prepareStartTs = Date.now();
      const PREPARE_TIMEOUT_MS = 3e3;
      if (!startLocName) {
        console.warn(`[Dispatch] \u8D77\u70B9\u5730\u5740\u4E3A\u7A7A\uFF0C\u6807\u8BB0\u5750\u6807\u672A\u77E5\uFF0C\u76F4\u63A5\u8FDB\u5927\u5385`);
        orderData.coordsUnknown = true;
      } else if (isDefaultCentroid || isNaN(pLat) || isNaN(pLng)) {
        const orderCity = String(orderData.city || req.body?.city || "").trim();
        const geocodePromise = geocodeServerPoiAsync(startLocName, pLat, pLng, orderCity);
        const timeoutPromise = new Promise(
          (resolve) => setTimeout(() => resolve({ lat: pLat, lng: pLng, reliable: false, timedOut: true }), PREPARE_TIMEOUT_MS)
        );
        const poi = await Promise.race([geocodePromise, timeoutPromise]);
        if (poi.timedOut) {
          console.warn(`[Dispatch] \u9AD8\u5FB7\u89E3\u67903\u79D2\u8D85\u65F6: ${startLocName}\uFF0C\u6807\u8BB0\u5750\u6807\u672A\u77E5`);
          orderData.coordsUnknown = true;
        } else {
          pLat = poi.lat;
          pLng = poi.lng;
          if (!poi.reliable) {
            orderData.coordsUnknown = true;
          }
        }
      }
      const prepareElapsed = Date.now() - prepareStartTs;
      console.log(`[Dispatch] \u51C6\u5907\u671F\u8017\u65F6: ${prepareElapsed}ms`);
      if (prepareElapsed < PREPARE_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, PREPARE_TIMEOUT_MS - prepareElapsed));
        console.log(`[Dispatch] \u51C6\u5907\u671F\u8865\u8DB3\u81F33\u79D2`);
      }
      const dbData = readLocalJsonDb();
      let squadList = [];
      let locationMap = {};
      let driverDocMap = {};
      const _poolHit = await getDispatchPoolsCached();
      if (_poolHit) {
        squadList = _poolHit.squadList;
        locationMap = _poolHit.locationMap;
        driverDocMap = _poolHit.driverDocMap;
      }
      if (!_poolHit) {
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [squadRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              ["squad_members"]
            );
            squadList = (squadRows || []).map((r) => {
              const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const rawId = String(r.doc_id || "");
              return { phone: rawId.replace(/\D/g, "").trim(), rawId, data };
            }).filter((item) => {
              if (/a$/i.test(String(item.rawId || "").trim())) return false;
              return Boolean(item.phone);
            });
            {
              const seen = /* @__PURE__ */ new Map();
              for (const item of squadList) {
                const cp = String(item.phone || "");
                const prev = seen.get(cp);
                if (!prev) {
                  seen.set(cp, item);
                  continue;
                }
                const prevValid = isLicenseValid(prev?.data?.licenseExpiry);
                const curValid = isLicenseValid(item?.data?.licenseExpiry);
                if (!prevValid && curValid) seen.set(cp, item);
              }
              squadList = Array.from(seen.values());
            }
            const [locRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              ["driver_locations"]
            );
            (locRows || []).forEach((r) => {
              const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const p = String(r.doc_id || data?.phone || "").replace(/\D/g, "").trim();
              if (p) locationMap[p] = data;
            });
          } catch (_) {
          }
        }
        if (squadList.length === 0) {
          const colData = dbData["squad_members"] || {};
          squadList = Object.keys(colData).map((k) => ({
            phone: String(k).replace(/\D/g, "").trim(),
            rawId: String(k),
            data: colData[k]
          })).filter((item) => {
            if (/a$/i.test(String(item.rawId || "").trim())) return false;
            return Boolean(item.phone);
          });
          {
            const seen = /* @__PURE__ */ new Map();
            for (const item of squadList) {
              const cp = String(item.phone || "");
              const prev = seen.get(cp);
              if (!prev) {
                seen.set(cp, item);
                continue;
              }
              const prevValid = isLicenseValid(prev?.data?.licenseExpiry);
              const curValid = isLicenseValid(item?.data?.licenseExpiry);
              if (!prevValid && curValid) seen.set(cp, item);
            }
            squadList = Array.from(seen.values());
          }
        }
        const localLocations = dbData["driver_locations"] || {};
        Object.keys(localLocations).forEach((k) => {
          const p = String(k).replace(/\D/g, "").trim();
          if (p && !locationMap[p]) {
            locationMap[p] = localLocations[k];
          }
        });
        if (!squadList.some((s) => s.phone === "15509601222")) {
          let devDriverData = {};
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [devRows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                ["driver_users", "15509601222"]
              );
              if (devRows && devRows[0]) {
                const d = devRows[0].data;
                devDriverData = typeof d === "string" ? JSON.parse(d) : d;
              }
            } catch (_) {
            }
          } else {
            devDriverData = dbData["driver_users"]?.["15509601222"] || {};
          }
          squadList.push({
            phone: "15509601222",
            data: {
              ...devDriverData,
              role: "\u5F00\u53D1\u8005\u53F8\u673A",
              userRole: "\u5F00\u53D1\u8005\u53F8\u673A",
              driverName: devDriverData.driverName || "\u5434\u5F66\u7956",
              status: "\u5DF2\u901A\u8FC7"
            }
          });
        }
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [duRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              ["driver_users"]
            );
            (duRows || []).forEach((r) => {
              try {
                const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
                const p = String(r.doc_id || d?.phone || "").replace(/\D/g, "").trim();
                if (p) driverDocMap[p] = d;
              } catch (_) {
              }
            });
          } catch (_) {
          }
        }
        Object.keys(dbData["driver_users"] || {}).forEach((k) => {
          const p = String(k).replace(/\D/g, "").trim();
          if (p && !driverDocMap[p]) driverDocMap[p] = dbData["driver_users"][k];
        });
        await saveDispatchPoolsCache({ squadList, locationMap, driverDocMap });
      }
      const orderId = String(orderData.id || orderData.orderId || `ORDER_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`).trim();
      {
        const issued = _orderNoByOrderId.get(orderId);
        if (issued) {
          orderData.orderNo = issued.orderNo;
          orderData.seqNumber = issued.seq;
        } else {
          const tsForNo = Date.now();
          const dNo = new Date(tsForNo);
          const p2 = (n) => String(n).padStart(2, "0");
          const noBase = `YC${dNo.getFullYear()}${p2(dNo.getMonth() + 1)}${p2(dNo.getDate())}${p2(dNo.getHours())}${p2(dNo.getMinutes())}`;
          let seq = tsForNo % 1e5;
          let candidate = noBase + String(seq).padStart(5, "0");
          while (_issuedOrderNos.has(candidate)) {
            seq = (seq + 1) % 1e5;
            candidate = noBase + String(seq).padStart(5, "0");
          }
          _issuedOrderNos.add(candidate);
          _orderNoByOrderId.set(orderId, { orderNo: candidate, seq });
          if (_issuedOrderNos.size > 5e4) _issuedOrderNos.clear();
          if (_orderNoByOrderId.size > 5e4) _orderNoByOrderId.clear();
          orderData.orderNo = candidate;
          orderData.seqNumber = seq;
        }
      }
      const pendingMap = await getPendingDispatchMap();
      const activeClaimedSet = await getActiveClaimedDriverSet().catch(() => /* @__PURE__ */ new Set());
      const candidates = [];
      let removedPhonesArr = [];
      try {
        removedPhonesArr = await readRemovedPhonesMergedUnified();
      } catch (_) {
        removedPhonesArr = dbData.config?.["removed_squad_members"]?.phones || [];
      }
      const diagOrderId = orderId;
      const diagFiltered = [];
      const diagPush = (rawPhone, reason) => {
        try {
          diagFiltered.push({ phone: String(rawPhone || "").replace(/\D/g, "").trim(), reason });
        } catch (_) {
        }
      };
      const maskPhone = (p) => {
        const s = String(p || "");
        return s.length >= 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : s || "\u672A\u77E5";
      };
      try {
        const diagRec = squadList.find(({ phone }) => String(phone).replace(/\D/g, "").trim() === "15509601222");
        if (diagRec) {
          const d = diagRec.data || {};
          const loc = locationMap["15509601222"] || {};
          console.log(`[DispatchDiag] \u8BA2\u5355 ${diagOrderId} | 15509601222: status=${d.status || d.approvalStatus}, license=${d.licenseExpiry}, role=${d.role}, isOnline=${loc.isOnline}, isBusy=${loc.isBusy}, gpsValid=${loc.gpsValid}, lat=${loc.lat}, lng=${loc.lng}`);
        } else {
          console.log(`[DispatchDiag] \u8BA2\u5355 ${diagOrderId} | 15509601222: \u4E0D\u5728 squadList \u4E2D! squadList\u957F\u5EA6=${squadList.length}`);
        }
      } catch (_) {
      }
      const existingDispatchedPhone = String(orderData.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
      squadList.forEach(({ phone, data }) => {
        const cleanPhone0 = String(phone || "").replace(/\D/g, "").trim();
        if (!phone || !data || data.isBanned) {
          diagPush(cleanPhone0, `\u65E0phone/data\u6216\u88AB\u7981\u7528(isBanned=${Boolean(data?.isBanned)})`);
          return;
        }
        const cleanPhone = cleanPhone0;
        if (cleanPhone !== "15509601222" && (removedPhonesArr.includes(cleanPhone) || isGenericDriverName(data.driverName || data.name, cleanPhone))) {
          diagPush(cleanPhone, removedPhonesArr.includes(cleanPhone) ? "\u5728\u79FB\u9664\u540D\u5355\u4E2D" : "\u5360\u4F4D\u53F8\u673A\u540D");
          return;
        }
        const cleanReporter = reporterPhone ? String(reporterPhone).replace(/\D/g, "").trim() : "";
        const cleanExclude = excludePhone ? String(excludePhone).replace(/\D/g, "").trim() : "";
        const isTransferOrder = Boolean(
          orderData.orderType === "\u62A5\u5355\u8F6C\u5355" || orderData.orderRemark === "\u62A5\u5355\u8F6C\u5355" || orderData.type === "\u62A5\u5355\u8F6C\u5355" || String(orderData.orderRemark || "").includes("\u62A5\u5355\u8F6C\u5355") || String(orderData.destination || "").includes("\u62A5\u5355\u8F6C\u5355")
        );
        if (isTransferOrder) {
          if (cleanPhone && (cleanPhone === cleanReporter || cleanPhone === cleanExclude)) {
            diagPush(cleanPhone, "\u62A5\u5355\u8F6C\u5355\u6392\u9664\u672C\u4EBA");
            return;
          }
        }
        const st = effectiveMemberStatus(data);
        if (cleanPhone !== "15509601222" && !["\u5DF2\u901A\u8FC7", "approved", "\u901A\u8FC7"].includes(st)) {
          diagPush(cleanPhone, `\u5BA1\u6279\u672A\u901A\u8FC7(status=${st || "\u7A7A"})`);
          return;
        }
        const candLic = resolveExpiryFromDocs(data, driverDocMap[cleanPhone]).licenseExpiry;
        if (!isLicenseValid(candLic)) {
          diagPush(cleanPhone, `\u63A5\u5355\u6388\u6743\u65E0\u6548(licenseExpiry=${candLic || "\u7A7A"})`);
          return;
        }
        if (cleanPhone !== "15509601222") {
          const role = String(data.role || data.userRole || data.approvedRole || "").trim();
          if ((role.includes("\u5546\u6237") || role.includes("\u5546\u5BB6")) && !role.includes("\u53F8\u673A") && !role.includes("\u7BA1\u7406")) {
            diagPush(cleanPhone, `\u7EAF\u5546\u6237\u89D2\u8272(${role || "\u7A7A"})`);
            return;
          }
          const allowedRoles = ["\u5F00\u53D1\u8005\u53F8\u673A", "\u5F00\u53D1\u8005", "\u603B\u6307\u6325\u5B98", "\u57CE\u5E02\u8001\u677F\u53F8\u673A", "\u57CE\u5E02\u8001\u677F", "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A", "\u57CE\u5E02\u7BA1\u7406", "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A", "\u57CE\u5E02\u6D3E\u5355\u5458", "\u666E\u901A\u53F8\u673A", "\u961F\u5458", "\u5C0F\u961F\u957F"];
          const hasAllowedRole = allowedRoles.some((r) => role.includes(r)) || role === "";
          if (!hasAllowedRole) {
            diagPush(cleanPhone, `\u89D2\u8272\u4E0D\u5408\u6CD5(${role || "\u7A7A"})`);
            return;
          }
        }
        const loc = locationMap[cleanPhone] || {};
        const isOnline = loc.isOnline === true || loc.isOnline === "true" || cleanPhone === "15509601222" && loc.isOnline !== false;
        if (!isOnline) {
          diagPush(cleanPhone, `\u672A\u4E0A\u7EBF(isOnline=${loc.isOnline})`);
          return;
        }
        const isBusy = loc.isBusy === true || loc.isBusy === "true" || loc.isBusy === 1;
        if (isBusy) {
          diagPush(cleanPhone, "\u5FD9\u788C\u4E2D");
          return;
        }
        {
          const occ = occupancyOf(cleanPhone, pendingMap, loc);
          if (occ.occupied) {
            diagPush(cleanPhone, occ.reason === "pending" ? "\u6709\u672A\u51B3\u6D3E\u5355" : "\u62A5\u5355\u4E2D");
            return;
          }
        }
        if (activeClaimedSet.has(cleanPhone)) {
          diagPush(cleanPhone, "\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u63A5\u5355(\u8BA2\u5355\u4E8B\u5B9E)");
          return;
        }
        if (loc.gpsValid === false) {
          diagPush(cleanPhone, "GPS\u65E0\u6548\u6807\u8BB0(gpsValid=false)");
          return;
        }
        let dLat = Number(loc.lat ?? loc.latitude ?? data.lat ?? data.latitude);
        let dLng = Number(loc.lng ?? loc.longitude ?? data.lng ?? data.longitude);
        if (isNaN(dLat) || isNaN(dLng) || dLat === 0 || dLng === 0) {
          diagPush(cleanPhone, `\u5750\u6807\u65E0\u6548(lat=${loc.lat},lng=${loc.lng})`);
          return;
        }
        const distKm = !isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0 ? calculateHaversineKm(pLat, pLng, dLat, dLng) : Infinity;
        if (distKm <= radiusKm) {
          candidates.push({
            phone: cleanPhone,
            name: data.driverName || data.name || (cleanPhone === "15509601222" ? "\u5434\u5F66\u7956" : `\u53F8\u673A${cleanPhone.slice(-4)}`),
            distKm,
            data
          });
        } else {
          diagPush(cleanPhone, `\u8DDD\u79BB${distKm.toFixed(2)}km\u8D85${radiusKm}km\u534A\u5F84`);
        }
      });
      try {
        if (diagFiltered.length > 0) {
          const sum = diagFiltered.map((r) => `${maskPhone(r.phone)}[${r.reason}]`).join("\uFF1B");
          console.log(`[DispatchDiag] \u8BA2\u5355 ${diagOrderId} | \u6DD8\u6C70${diagFiltered.length}\u4EBA: ${sum}`);
        }
        const candSum = candidates.map((c) => `${maskPhone(c.phone)}(${Number(c.distKm).toFixed(2)}km)`).join("\u3001");
        console.log(`[DispatchDiag] \u8BA2\u5355 ${diagOrderId} | \u5019\u9009${candidates.length}\u4EBA${candSum ? ": " + candSum : ""}`);
      } catch (_) {
      }
      const diagForDev = req.isAdmin === true ? {
        orderId: diagOrderId,
        filtered: diagFiltered.map((r) => ({ phone: maskPhone(r.phone), reason: r.reason })),
        candidates: candidates.map((c) => ({ phone: maskPhone(c.phone), distKm: Number(Number(c.distKm).toFixed(2)) }))
      } : void 0;
      const coordsUnknownForDispatch = Boolean(orderData?.coordsUnknown);
      const coordFields = coordsUnknownForDispatch ? {} : {
        passengerLat: pLat,
        passengerLng: pLng,
        resolvedLat: pLat,
        resolvedLng: pLng
      };
      if (coordsUnknownForDispatch) {
        console.warn(`[Dispatch] \u5750\u6807\u672A\u77E5\uFF0C\u76F4\u63A5\u8F6C\u5165\u9009\u5355\u5927\u5385\uFF0C\u4E0D\u505A\u8DDD\u79BB\u6D3E\u5355`);
      }
      if (!coordsUnknownForDispatch && candidates.length > 0) {
        let selected = null;
        {
          const minDist = Math.min(...candidates.map((c) => c.distKm));
          const tiedCandidates = candidates.filter((c) => Math.abs(c.distKm - minDist) <= 0.02 || c.distKm <= 0.02);
          selected = tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
        }
        console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u9009\u4E2D\u53F8\u673A ${selected?.phone}, \u5F00\u59CB\u6700\u7EC8\u6821\u9A8C...`);
        console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u6B65\u9AA41: license\u68C0\u67E5, selLic=${selected?.data?.licenseExpiry}`);
        if (selected) {
          const selLic = resolveExpiryFromDocs(selected?.data, driverDocMap[String(selected.phone).replace(/\D/g, "").trim()]).licenseExpiry;
          if (!isLicenseValid(selLic)) {
            console.log(`[Dispatch] \u53F8\u673A ${selected.phone} \u63A5\u5355\u6388\u6743\u65E0\u6548\uFF0C\u6700\u7EC8\u62E6\u622A\uFF1A\u8BA2\u5355 ${orderId} \u76F4\u63A5\u8F6C\u5165\u9009\u5355\u5927\u5385`);
            selected = null;
          }
        }
        if (selected) {
          const selVip = resolveExpiryFromDocs(selected?.data, driverDocMap[String(selected.phone).replace(/\D/g, "").trim()]).vipExpiry;
          console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u6B65\u9AA42: VIP\u68C0\u67E5, selVip=${selVip}, isVipActive=${isVipActiveServer(selVip)}`);
          if (!isVipActiveServer(selVip)) {
            let todayCount = 0;
            try {
              console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u5F00\u59CB\u7EDF\u8BA1\u53F8\u673A\u4ECA\u65E5\u5B8C\u6210\u5355\u6570...`);
              todayCount = await Promise.race([
                countTodayCompletedOrders(String(selected.phone).replace(/\D/g, "")),
                new Promise(
                  (_, reject) => setTimeout(() => reject(new Error("[MySQL\u8D85\u65F6] \u4ECA\u65E5\u5355\u6570\u7EDF\u8BA1\u8D85\u8FC710\u79D2")), 1e4)
                )
              ]);
              console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u53F8\u673A\u4ECA\u65E5\u5DF2\u5B8C\u6210 ${todayCount} \u5355`);
            } catch (e) {
              console.error(`[Dispatch] \u8BA2\u5355 ${orderId} \u7EDF\u8BA1\u4ECA\u65E5\u5355\u6570\u5931\u8D25\uFF0C\u63090\u5355\u7EE7\u7EED:`, e?.message);
              todayCount = 0;
            }
            if (todayCount >= 2) {
              console.log(`[Dispatch] \u53F8\u673A ${selected.phone} \u975EVIP\u4ECA\u65E5\u5DF2\u5B8C\u6210${todayCount}\u5355\uFF0C\u8DF3\u8FC7\uFF1A\u8BA2\u5355 ${orderId} \u8F6C\u5927\u5385`);
              selected = null;
            }
          }
        }
        {
          let freshOrder = null;
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [h6rows] = await mysqlQueryTimeout(
                mysqlPool,
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                ["merchant_orders", orderId],
                5e3,
                "H6\u5E76\u53D1\u6D3E\u5355\u68C0\u67E5"
              );
              if (h6rows && h6rows[0]) {
                const d = h6rows[0].data;
                freshOrder = typeof d === "string" ? JSON.parse(d) : d;
              }
            } catch (e) {
              console.error(`[Dispatch] \u8BA2\u5355 ${orderId} H6\u68C0\u67E5\u5931\u8D25\uFF0C\u6309\u672A\u6D3E\u5355\u7EE7\u7EED:`, e?.message);
            }
          } else {
            try {
              if (_dbDirty && cachedDbData) {
                freshOrder = cachedDbData?.["merchant_orders"]?.[orderId];
              } else {
                const content = await import_fs.default.promises.readFile(LOCAL_JSON_DB_PATH, "utf8");
                const freshDb = JSON.parse(content || "{}");
                freshOrder = freshDb?.["merchant_orders"]?.[orderId];
              }
            } catch (e) {
              console.error(`[Dispatch] \u8BA2\u5355 ${orderId} H6\u672C\u5730\u8BFB\u53D6\u5931\u8D25\uFF0C\u6309\u672A\u6D3E\u5355\u7EE7\u7EED:`, e?.message);
            }
          }
          const alreadyDispatched = String(freshOrder?.dispatchedDriverPhone || "").trim();
          const alreadyClaimed = String(freshOrder?.claimedDriverPhone || "").trim();
          if (alreadyDispatched || alreadyClaimed) {
            console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u5DF2\u88AB\u6D3E\u5355/\u62A2\u5355\uFF08${alreadyDispatched || alreadyClaimed}\uFF09\uFF0C\u672C\u6B21\u8DF3\u8FC7\u5199\u5165`);
            return res.json({ success: true, dispatched: true, driverPhone: alreadyDispatched || alreadyClaimed, alreadyDispatched: true });
          }
        }
        if (!selected) {
          const hallPayload = {
            ...orderData,
            id: orderId,
            orderId,
            ...coordFields,
            status: "hall",
            in_hall: true,
            statusCategory: "\u7B49\u5F85\u63A5\u5355",
            // 2026-10-23 第二十五轮：与无候选分支同口径补分类，防徽章分类三分裂
            hallReason: "no_licensed_driver",
            hallAt: Date.now(),
            timestamp: Date.now()
          };
          try {
            const db2 = readLocalJsonDb();
            db2["merchant_orders"] = db2["merchant_orders"] || {};
            db2["merchant_orders"][orderId] = hallPayload;
            writeLocalJsonDb(db2);
            if (isMySQLEnabled && mysqlPool) {
              let hallWriteErr = null;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  await mysqlPool.query(
                    "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                    ["merchant_orders", orderId, JSON.stringify(hallPayload)]
                  );
                  hallWriteErr = null;
                  break;
                } catch (e) {
                  hallWriteErr = e;
                }
              }
              if (hallWriteErr) throw hallWriteErr;
            }
          } catch (e) {
            console.error(`[Dispatch] \u8BA2\u5355 ${orderId} \u65E0\u6388\u6743\u53F8\u673A\u8F6C\u5927\u5385\u5199\u5165\u5931\u8D25:`, e?.message);
            return res.status(500).json({ success: false, error: "\u8BA2\u5355\u8F6C\u5927\u5385\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
          }
          console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u65E0\u6388\u6743\u53F8\u673A\uFF0C\u76F4\u63A5\u8F6C\u5165\u9009\u5355\u5927\u5385`);
          return res.json({ success: true, dispatched: false, toHall: true, orderId, orderNo: orderData.orderNo, reason: "no_licensed_driver", ...diagForDev ? { diag: diagForDev } : {} });
        }
        const distText = selected.distKm < 1 ? `${Math.max(50, Math.round(selected.distKm * 1e3))}\u7C73` : `${selected.distKm.toFixed(2)}\u516C\u91CC`;
        const nowTs = Date.now();
        {
          const pendFresh = await getPendingDispatchForPhone(String(selected.phone).trim(), true).catch(() => null);
          if (pendFresh && pendFresh.orderId !== orderId) {
            const conflictPayload = {
              ...orderData,
              id: orderId,
              orderId,
              ...coordFields,
              status: "hall",
              in_hall: true,
              statusCategory: "\u7B49\u5F85\u63A5\u5355",
              // 2026-10-23 第二十五轮：同上
              hallReason: "pending_conflict",
              hallAt: nowTs,
              timestamp: nowTs
            };
            try {
              const db3 = readLocalJsonDb();
              db3["merchant_orders"] = db3["merchant_orders"] || {};
              db3["merchant_orders"][orderId] = conflictPayload;
              writeLocalJsonDb(db3);
              if (isMySQLEnabled && mysqlPool) {
                let conflictWriteErr = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    await mysqlPool.query(
                      "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                      ["merchant_orders", orderId, JSON.stringify(conflictPayload)]
                    );
                    conflictWriteErr = null;
                    break;
                  } catch (e) {
                    conflictWriteErr = e;
                  }
                }
                if (conflictWriteErr) throw conflictWriteErr;
              }
            } catch (e) {
              console.error(`[Dispatch] \u8BA2\u5355 ${orderId} pending_conflict \u8F6C\u5927\u5385\u5199\u5165\u5931\u8D25:`, e?.message);
              return res.status(500).json({ success: false, error: "\u8BA2\u5355\u8F6C\u5927\u5385\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
            }
            console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u9009\u4E2D\u53F8\u673A ${selected.phone} \u5DF2\u6709\u672A\u51B3\u6D3E\u5355 ${pendFresh.orderId}\uFF08\u5E76\u53D1\u7ADE\u6001\uFF09\uFF0C\u672C\u5355\u8F6C\u5927\u5385(pending_conflict)\uFF0C\u4E0D\u9876\u65E7\u5355`);
            return res.json({ success: true, dispatched: false, toHall: true, orderId, orderNo: orderData.orderNo, reason: "pending_conflict", ...diagForDev ? { diag: diagForDev } : {} });
          }
        }
        const driverQrUrl = import_fs.default.existsSync(import_path.default.join(process.cwd(), "uploads", "qrcodes", `${selected.phone}.png`)) ? `/uploads/qrcodes/${selected.phone}.png` : "";
        const dispatchedPayload = {
          ...orderData,
          id: orderId,
          orderId,
          ...coordFields,
          status: "submitted",
          // 2026-10-17根治：派单成功必须显式 in_hall=false。客户端orderData带的in_hall恒为true
          // （App内商户代叫从不本地选司机），不覆盖则DB里status=dispatched但in_hall=true，
          // 接单接口的in_hall检查会409拦截，且大厅列表会把dispatched单显示出来。
          in_hall: false,
          isValetOrder: true,
          isPlatformDispatch: true,
          dispatchedDriverPhone: selected.phone,
          dispatchedDriverName: selected.name,
          paymentQrCode: driverQrUrl,
          qrCode: driverQrUrl,
          wechatQrCode: driverQrUrl,
          qrcode_url: driverQrUrl,
          driverQrCode: driverQrUrl,
          distanceText: distText,
          distKm: selected.distKm,
          dispatchCountdown: 60,
          serverCountdown: 60,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 6e4,
          timestamp: nowTs,
          // 2026-10-13修复：记录对应的 merchant_orders key，
          // 倒计时接口没带 orderId 时可直接定位主订单，避免反查失败导致重复重置
          _merchantKey: orderId
        };
        if (!dbData["passenger_links"]) dbData["passenger_links"] = {};
        dbData["passenger_links"][selected.phone] = dispatchedPayload;
        if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
        dbData["merchant_orders"][orderId] = {
          ...dispatchedPayload,
          status: "dispatched",
          statusCategory: "\u5DF2\u6307\u6D3E",
          dispatchCountdown: 60,
          serverCountdown: 60,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 6e4,
          timestamp: nowTs
        };
        console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u6B65\u9AA45: \u672C\u5730\u7F13\u5B58\u5199\u5F00\u59CB`);
        writeLocalJsonDb(dbData, !(isMySQLEnabled && mysqlPool));
        console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u6B65\u9AA45: \u672C\u5730\u7F13\u5B58\u5199\u7ED3\u675F`);
        if (isMySQLEnabled && mysqlPool) {
          const mysqlWrites = [
            [
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["passenger_links", selected.phone, JSON.stringify(dispatchedPayload)]
            ],
            [
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["merchant_orders", orderId, JSON.stringify({ ...dispatchedPayload, status: "dispatched", statusCategory: "\u5DF2\u6307\u6D3E" })]
            ]
          ];
          for (let _wi = 0; _wi < mysqlWrites.length; _wi++) {
            const [sql, params] = mysqlWrites[_wi];
            const _step = _wi === 0 ? "\u6B65\u9AA46" : "\u6B65\u9AA47";
            const _coll = String(params?.[0] || "");
            console.log(`[Dispatch] \u8BA2\u5355 ${orderId} ${_step}: MySQL\u5199\u5165\u5F00\u59CB(${_coll})`);
            let ok = false;
            let lastErr = null;
            for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
              try {
                await mysqlQueryTimeout(mysqlPool, sql, params, 3e3, `\u6D3E\u5355\u53CC\u5199(\u5C1D\u8BD5${attempt}/3)`);
                ok = true;
                console.log(`[Dispatch] \u8BA2\u5355 ${orderId} ${_step}: MySQL\u5199\u5165\u6210\u529F(${_coll},\u5C1D\u8BD5${attempt}/3)`);
              } catch (e) {
                lastErr = e;
                if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
              }
            }
            if (!ok) {
              console.error(`[Dispatch] \u8BA2\u5355 ${orderId} MySQL \u5199\u5165\u5931\u8D25(3\u6B21\u91CD\u8BD5):`, lastErr?.message);
              if (lockOrderId) dispatchOrderLocks.delete(lockOrderId);
              return res.status(500).json({ success: false, error: "\u6D3E\u5355\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
            }
          }
        }
        console.log(`[Dispatch] \u8BA2\u5355 ${orderId} \u6B65\u9AA48: \u6D3E\u5355\u5199\u5165\u5168\u90E8\u5B8C\u6210\uFF0C\u8FD4\u56DE\u6210\u529F`);
        return res.json({
          success: true,
          isHall: false,
          orderId,
          orderNo: orderData.orderNo,
          dispatchedDriverPhone: selected.phone,
          dispatchedDriverName: selected.name,
          distKm: selected.distKm,
          distanceText: distText,
          passengerLat: pLat,
          passengerLng: pLng,
          remainingSeconds: 60,
          dispatchCountdown: 60,
          serverTime: nowTs,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 6e4,
          ...diagForDev ? { diag: diagForDev } : {}
        });
      } else {
        const nowTs = Date.now();
        const hallPayload = {
          ...orderData,
          id: orderId,
          orderId,
          ...coordFields,
          status: "hall",
          statusCategory: "\u7B49\u5F85\u63A5\u5355",
          in_hall: true,
          isValetOrder: true,
          isPlatformDispatch: true,
          timestamp: nowTs,
          hallAt: nowTs
        };
        if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
        dbData["merchant_orders"][orderId] = hallPayload;
        writeLocalJsonDb(dbData);
        if (isMySQLEnabled && mysqlPool) {
          let lobbyWriteErr = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await mysqlPool.query(
                "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                ["merchant_orders", orderId, JSON.stringify(hallPayload)]
              );
              lobbyWriteErr = null;
              break;
            } catch (e) {
              lobbyWriteErr = e;
            }
          }
          if (lobbyWriteErr) {
            console.error(`[Dispatch] \u8BA2\u5355 ${orderId} \u65E0\u5019\u9009\u8F6C\u5927\u5385 MySQL \u5199\u5165\u5931\u8D25:`, lobbyWriteErr?.message);
            return res.status(500).json({ success: false, error: "\u8BA2\u5355\u8F6C\u5927\u5385\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
          }
        }
        return res.json({
          success: true,
          isHall: true,
          orderId,
          orderNo: orderData.orderNo,
          passengerLat: pLat,
          passengerLng: pLng,
          serverTime: nowTs,
          coordsUnknown: coordsUnknownForDispatch || void 0,
          ...diagForDev ? { diag: diagForDev } : {},
          message: coordsUnknownForDispatch ? "\u8D77\u70B9\u5750\u6807\u672A\u77E5\uFF0C\u5DF2\u8F6C\u5165\u9009\u5355\u5927\u5385\u4F9B\u5C0F\u961F\u53F8\u673A\u62A2\u5355" : "\u65B9\u57063\u516C\u91CC\u5185\u65E0\u5728\u7EBF\u7A7A\u95F2\u53F8\u673A\uFF0C\u5DF2\u5168\u5458\u5E7F\u64AD\u8F6C\u5165\u9009\u5355\u5927\u5385"
        });
      }
    } catch (err) {
      console.error("[Dispatch Nearest Exception]:", err);
      try {
        const failOrderId = String(req.body?.orderData?.orderId || req.body?.orderData?.id || req.body?.orderData?.orderNo || "").trim();
        if (failOrderId) dispatchOrderLocks.delete(failOrderId);
      } catch (_) {
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/order/claim", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const arrivedAt = Date.now();
      const { orderId, driverName, orderPayload } = req.body;
      const cleanOrderId = String(orderId || "").trim();
      const authPhoneRaw = String(req.authPhone || "").trim();
      if (/a$/i.test(authPhoneRaw)) {
        return res.status(403).json({ success: false, error: "\u5546\u6237\u8EAB\u4EFD\u4E0D\u80FD\u62A2\u5355" });
      }
      const cleanDriverPhone = authPhoneRaw.replace(/\D/g, "").trim();
      let claimExpiryUnified = null;
      try {
        claimExpiryUnified = await readDriverExpiryUnified(cleanDriverPhone);
        if (!isLicenseValid(claimExpiryUnified.licenseExpiry)) {
          return res.status(403).json({ success: false, error: "\u63A5\u5355\u6388\u6743\u5DF2\u5230\u671F\uFF0C\u8BF7\u8054\u7CFB\u5F00\u53D1\u8005\u5145\u503C" });
        }
      } catch (e) {
        console.error("[Claim] \u63A5\u5355\u6388\u6743\u6821\u9A8C\u5F02\u5E38:", e?.message);
        return res.status(503).json({ success: false, error: "\u6388\u6743\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      try {
        const vipExpiry = claimExpiryUnified ? claimExpiryUnified.vipExpiry : (await readDriverExpiryUnified(cleanDriverPhone)).vipExpiry;
        if (!isVipActiveServer(vipExpiry)) {
          const todayCount = await countTodayCompletedOrders(cleanDriverPhone);
          if (todayCount >= 2) {
            return res.status(403).json({ success: false, error: "\u975EVIP\u4F1A\u5458\u6BCF\u5929\u96502\u5355\uFF0C\u660E\u65E96\u70B9\u81EA\u52A8\u6062\u590D\u3002\u5982\u9700\u65E0\u9650\u63A5\u5355\u8BF7\u5F00\u901AVIP" });
          }
        }
      } catch (e) {
        console.error("[Claim] VIP\u9650\u989D\u6821\u9A8C\u5F02\u5E38:", e?.message);
      }
      const cleanDriverName = String(driverName || `\u53F8\u673A${cleanDriverPhone.slice(-4)}`).trim();
      if (!cleanOrderId || !cleanDriverPhone) {
        return res.status(400).json({ success: false, error: "Missing orderId" });
      }
      const ALLOWED_CLAIM_FIELDS = /* @__PURE__ */ new Set(["driverNote", "driverLocation", "driverLat", "driverLng", "estimatedArrival"]);
      const safePayload = {};
      if (orderPayload && typeof orderPayload === "object") {
        for (const k of Object.keys(orderPayload)) {
          if (ALLOWED_CLAIM_FIELDS.has(k)) safePayload[k] = orderPayload[k];
        }
      }
      const dbData = readLocalJsonDb();
      let removedPhonesArr = [];
      try {
        removedPhonesArr = await readRemovedPhonesMergedUnified();
      } catch (_) {
        removedPhonesArr = dbData.config?.["removed_squad_members"]?.phones || [];
      }
      const isRemovedDriver = cleanDriverPhone !== "15509601222" && removedPhonesArr.includes(cleanDriverPhone);
      const isDevDriver = cleanDriverPhone === "15509601222";
      let isSquadApproved = isDevDriver;
      if (!isDevDriver && !isRemovedDriver) {
        let squadDoc = null;
        try {
          squadDoc = await readStatusDocument("squad_members", cleanDriverPhone);
        } catch (_) {
        }
        if (squadDoc && isApprovedMemberStatus(effectiveMemberStatus(squadDoc))) {
          isSquadApproved = true;
        }
      }
      if (isRemovedDriver || !isSquadApproved) {
        return res.status(403).json({ success: false, error: "\u274C \u6743\u9650\u4E0D\u8DB3\uFF1A\u53EA\u6709\u5C0F\u961F\u5185\u5BA1\u6279\u901A\u8FC7\u7684\u6B63\u5F0F\u53F8\u673A\u624D\u80FD\u63A5\u6536\u5546\u6237\u4EE3\u53EB\u5355\u4E0E\u62A5\u5355\u8F6C\u5355\uFF01\u975E\u5C0F\u961F\u6210\u5458\u65E0\u63A5\u5355\u6743\u9650\u3002" });
      }
      if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
      let targetOrder = null;
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [crows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["merchant_orders", cleanOrderId]
          );
          if (crows && crows.length > 0) {
            targetOrder = typeof crows[0].data === "string" ? JSON.parse(crows[0].data) : crows[0].data;
          }
        } catch (_) {
        }
      }
      if (!targetOrder) {
        targetOrder = dbData["merchant_orders"][cleanOrderId];
      }
      if (!targetOrder) {
        return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      try {
        let busyLoc = null;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [brows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["driver_locations", cleanDriverPhone]
            );
            if (brows && brows.length > 0) {
              const braw = brows[0].data;
              busyLoc = typeof braw === "string" ? JSON.parse(braw) : braw;
            }
          } catch (_) {
          }
        }
        if (!busyLoc) {
          busyLoc = dbData.driver_locations?.[cleanDriverPhone];
        }
        if (busyLoc && (busyLoc.isBusy === true || busyLoc.isBusy === "true" || busyLoc.isBusy === 1)) {
          return res.status(409).json({ success: false, error: "\u60A8\u5F53\u524D\u6709\u884C\u7A0B\u4E2D\u7684\u8BA2\u5355\uFF0C\u8BF7\u5B8C\u6210\u540E\u518D\u62A2\u5355" });
        }
      } catch (_) {
      }
      try {
        const activeOther = await findDriverActiveOrderId(cleanDriverPhone, cleanOrderId);
        if (activeOther) {
          return res.status(409).json({ success: false, error: "\u60A8\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u8BA2\u5355\uFF0C\u8BF7\u5B8C\u6210\u540E\u518D\u63A5\u5355" });
        }
      } catch (_) {
      }
      if (targetOrder) {
        const isClaimedByOther = Boolean(targetOrder.claimedDriverPhone) && targetOrder.claimedDriverPhone !== cleanDriverPhone || targetOrder.status === "serving" && targetOrder.claimedDriverPhone && targetOrder.claimedDriverPhone !== cleanDriverPhone;
        const isCancelled = targetOrder.status === "cancelled" || targetOrder.statusCategory === "\u5DF2\u53D6\u6D88";
        if (isClaimedByOther || isCancelled) {
          return res.status(409).json({ success: false, error: "\u26A0\uFE0F \u8BE5\u8BA2\u5355\u5DF2\u88AB\u5176\u4ED6\u5C0F\u961F\u53F8\u673A\u62A2\u8D70\u6216\u5DF2\u53D6\u6D88\uFF01" });
        }
        {
          const dispatchedTo = String(targetOrder.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
          const tStatus = String(targetOrder.status || "");
          if (!dispatchedTo) {
            return res.status(409).json({ success: false, error: "\u8BE5\u8BA2\u5355\u672A\u6D3E\u5355\u7ED9\u4F60\uFF0C\u65E0\u6CD5\u63A5\u5355" });
          }
          if (tStatus === "hall" || targetOrder.in_hall === true) {
            return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u8D85\u65F6\u8FDB\u5165\u5927\u5385\uFF0C\u8BF7\u53BB\u5927\u5385\u62A2\u5355", inHall: true });
          }
          if (dispatchedTo !== cleanDriverPhone) {
            return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u8F6C\u6D3E\u7ED9\u5176\u4ED6\u53F8\u673A" });
          }
        }
      }
      {
        const claimedByMe = String(targetOrder.claimedDriverPhone || "").replace(/\D/g, "").trim() === cleanDriverPhone && (String(targetOrder.status || "") === "claimed" || Boolean(targetOrder.claimedAt));
        if (claimedByMe) {
          return res.json({ success: true, order: targetOrder, serverTime: Date.now(), idempotent: true });
        }
        const exp = Number(targetOrder.dispatchExpiresAt || 0);
        if (exp > 0 && arrivedAt > exp) {
          return res.status(409).json({ success: false, expired: true, error: "\u63A5\u5355\u8D85\u65F6\uFF0C\u6D3E\u5355\u5012\u8BA1\u65F6\u5DF2\u7ED3\u675F" });
        }
      }
      const now = Date.now();
      const driverQrUrl = import_fs.default.existsSync(import_path.default.join(process.cwd(), "uploads", "qrcodes", `${cleanDriverPhone}.png`)) ? `/uploads/qrcodes/${cleanDriverPhone}.png` : "";
      const claimUpdateData = {
        ...targetOrder || {},
        ...safePayload,
        id: cleanOrderId,
        orderId: cleanOrderId,
        status: "claimed",
        statusCategory: "\u5DF2\u63A5\u5355",
        in_hall: false,
        dispatchedDriverPhone: cleanDriverPhone,
        dispatchedDriverName: cleanDriverName,
        claimedDriverPhone: cleanDriverPhone,
        claimedDriverName: cleanDriverName,
        driverName: cleanDriverName,
        paymentQrCode: targetOrder && targetOrder.paymentQrCode || driverQrUrl,
        qrCode: targetOrder && targetOrder.qrCode || driverQrUrl,
        wechatQrCode: targetOrder && targetOrder.wechatQrCode || driverQrUrl,
        qrcode_url: targetOrder && targetOrder.qrcode_url || driverQrUrl,
        driverQrCode: driverQrUrl,
        claimedAt: now
      };
      dbData["merchant_orders"][cleanOrderId] = claimUpdateData;
      if (dbData["passenger_links"] && dbData["passenger_links"][cleanDriverPhone]) {
        delete dbData["passenger_links"][cleanDriverPhone];
      }
      if (!dbData["active_orders"]) dbData["active_orders"] = {};
      dbData["active_orders"][cleanDriverPhone] = {
        ...claimUpdateData,
        orderId: cleanOrderId,
        orderNo: req.body.orderNo || cleanOrderId,
        status: "claimed",
        statusCategory: "\u5DF2\u63A5\u5355",
        isCancelled: false
      };
      writeLocalJsonDb(dbData);
      const rollbackClaimJsonMirror = async () => {
        try {
          const [rrows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["merchant_orders", cleanOrderId]
          );
          const jdb = readLocalJsonDb();
          if (!jdb["merchant_orders"]) jdb["merchant_orders"] = {};
          if (rrows && rrows.length > 0) {
            jdb["merchant_orders"][cleanOrderId] = typeof rrows[0].data === "string" ? JSON.parse(rrows[0].data) : rrows[0].data;
          }
          const cur = jdb["merchant_orders"][cleanOrderId];
          if (cur && String(cur.claimedDriverPhone || "") !== cleanDriverPhone && jdb["active_orders"]?.[cleanDriverPhone]?.orderId === cleanOrderId) {
            delete jdb["active_orders"][cleanDriverPhone];
          }
          const [lrows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["passenger_links", cleanDriverPhone]
          );
          if (lrows && lrows.length > 0) {
            if (!jdb["passenger_links"]) jdb["passenger_links"] = {};
            jdb["passenger_links"][cleanDriverPhone] = typeof lrows[0].data === "string" ? JSON.parse(lrows[0].data) : lrows[0].data;
          }
          writeLocalJsonDb(jdb);
        } catch (_) {
        }
      };
      if (isMySQLEnabled && mysqlPool) {
        let claimOk = false;
        let claimErr = null;
        for (let attempt = 1; attempt <= 3 && !claimOk; attempt++) {
          try {
            const [updRes] = await mysqlPool.query(
              "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '') NOT IN ('claimed', '\u5DF2\u63A5\u5355', 'cancelled', '\u5DF2\u53D6\u6D88', 'hall', '\u7B49\u5F85\u63A5\u5355') AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.in_hall')), 'false') != 'true' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.claimedDriverPhone')), '') = '' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.claimedDriverPhone')), '') = ?)",
              [JSON.stringify(claimUpdateData), "merchant_orders", cleanOrderId, cleanDriverPhone]
            );
            const affected = Number(updRes?.affectedRows || 0);
            if (affected === 0) {
              await rollbackClaimJsonMirror();
              return res.status(409).json({ success: false, error: "\u8BE5\u8BA2\u5355\u5DF2\u88AB\u5176\u4ED6\u53F8\u673A\u63A5\u5355" });
            }
            claimOk = true;
          } catch (e) {
            claimErr = e;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
          }
        }
        if (!claimOk) {
          console.error(`[Claim] \u8BA2\u5355 ${cleanOrderId} MySQL \u5199\u5165\u5931\u8D25(3\u6B21\u91CD\u8BD5):`, claimErr?.message);
          await rollbackClaimJsonMirror();
          return res.status(500).json({ success: false, error: "\u63A5\u5355\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
        }
        try {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["passenger_links", cleanDriverPhone]
          ).catch(() => {
          });
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["active_orders", cleanDriverPhone, JSON.stringify(dbData["active_orders"][cleanDriverPhone])]
          );
        } catch (_) {
        }
      }
      if (isMySQLEnabled && mysqlPool) {
        try {
          for (const col of ["driver_locations", "driver_users"]) {
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(TRUE AS JSON)) WHERE `collection` = ? AND `doc_id` = ?',
              [col, cleanDriverPhone]
            ).catch(() => {
            });
          }
        } catch (_) {
        }
      } else {
        for (const col of ["driver_locations", "driver_users"]) {
          if (dbData[col] && dbData[col][cleanDriverPhone]) {
            dbData[col][cleanDriverPhone] = {
              ...dbData[col][cleanDriverPhone],
              isBusy: true,
              lastStatusUpdateTime: Date.now()
            };
          }
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true, order: claimUpdateData, serverTime: now });
    } catch (err) {
      console.error("[Order Claim Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/order/cancel", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const orderId = String(req.body.orderId || req.body.id || "").trim();
      const driverPhone = String(req.body.driverPhone || req.body.phone || "").replace(/\D/g, "").trim();
      const cancelReason = String(req.body.reason || req.body.cancelReason || "\u8BA2\u5355\u5DF2\u5F7B\u5E95\u53D6\u6D88").trim();
      const cancelledBy = String(req.body.cancelledBy || (driverPhone ? "driver" : "admin")).trim();
      if (!orderId) {
        return res.status(400).json({ success: false, error: "Missing orderId" });
      }
      const authPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      const isAdmin = !!req.isAdmin;
      const isManagement = isAdmin || !!req.isManager || !!req.isDispatcher;
      if (!isManagement) {
        let targetOrderCheck = {};
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [crows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["merchant_orders", orderId]
            );
            if (crows && crows.length > 0) {
              targetOrderCheck = typeof crows[0].data === "string" ? JSON.parse(crows[0].data) : crows[0].data;
            }
          } catch (_) {
          }
        } else {
          const dbDataCheck = readLocalJsonDb();
          targetOrderCheck = (dbDataCheck["merchant_orders"] || {})[orderId] || {};
        }
        const orderPlacer = String(targetOrderCheck.merchantPhone || targetOrderCheck.orderMerchantPhone || targetOrderCheck.phone || "").replace(/\D/g, "").trim();
        const orderDriver = String(targetOrderCheck.dispatchedDriverPhone || targetOrderCheck.driverPhone || targetOrderCheck.assignedDriver || targetOrderCheck.claimedDriverPhone || "").replace(/\D/g, "").trim();
        if (!orderPlacer && !orderDriver) {
          return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
        }
        if (authPhone !== orderPlacer && authPhone !== orderDriver) {
          return res.status(403).json({ success: false, error: "\u53EA\u6709\u4E0B\u5355\u65B9\u3001\u63A5\u5355\u53F8\u673A\u6216\u7BA1\u7406\u5458\u53EF\u4EE5\u53D6\u6D88\u8BA2\u5355" });
        }
      }
      console.log(`[Order Cancel] Permanent cancellation for orderId: ${orderId}, by: ${cancelledBy}, reason: ${cancelReason}`);
      const now = Date.now();
      const cancelPayload = {
        status: "cancelled",
        statusCategory: "\u5DF2\u53D6\u6D88",
        isCancelled: true,
        // 2026-10-23 第二十五轮：与 true-cancel 口径对齐——此前本接口订单文档独缺 isCancelled，只写 isCancelled 的通知文档反而齐全，终态判据踩缝
        in_hall: false,
        cancelledAt: now,
        cancelledBy,
        cancelledByRole: cancelledBy,
        cancelReason
      };
      const dbData = readLocalJsonDb();
      let checkSt = "";
      let checkCat = "";
      let canonicalOrder = null;
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [srows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["merchant_orders", orderId]
          );
          if (srows && srows.length > 0) {
            const sd = typeof srows[0].data === "string" ? JSON.parse(srows[0].data) : srows[0].data;
            checkSt = String(sd.status || "");
            checkCat = String(sd.statusCategory || "");
            canonicalOrder = sd;
          }
        } catch (_) {
        }
      }
      if (!checkSt && !checkCat) {
        const targetMerchantCheck = (dbData["merchant_orders"] || {})[orderId] || {};
        checkSt = String(targetMerchantCheck.status || "");
        checkCat = String(targetMerchantCheck.statusCategory || "");
      }
      const isServing = checkSt === "serving" || checkSt === "in_service" || checkSt === "started" || checkCat === "\u670D\u52A1\u4E2D" || checkCat === "\u8BA1\u8D39\u4E2D" || checkCat === "\u8FDB\u884C\u4E2D";
      const isCompleted = checkSt === "completed" || checkSt === "finished" || checkCat === "\u5DF2\u5B8C\u6210";
      if (isServing || isCompleted) {
        return res.status(400).json({ success: false, error: "\u8BA2\u5355\u8FDB\u884C\u4E2D\u6216\u5DF2\u5B8C\u6210\u4E0D\u53EF\u53D6\u6D88" });
      }
      if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
      const targetMerchant = canonicalOrder || dbData["merchant_orders"][orderId] || {};
      dbData["merchant_orders"][orderId] = {
        ...targetMerchant,
        ...cancelPayload
      };
      if (!dbData["valet_orders"]) dbData["valet_orders"] = {};
      if (dbData["valet_orders"][orderId]) {
        dbData["valet_orders"][orderId] = {
          ...dbData["valet_orders"][orderId],
          ...cancelPayload
        };
      }
      if (!dbData["orders"]) dbData["orders"] = {};
      if (dbData["orders"][orderId]) {
        dbData["orders"][orderId] = {
          ...dbData["orders"][orderId],
          ...cancelPayload
        };
      }
      const assignedDriver = driverPhone || targetMerchant.dispatchedDriverPhone || targetMerchant.claimedDriverPhone;
      if (assignedDriver) {
        const driverCancelNotice = {
          orderId,
          orderNo: req.body.orderNo || orderId,
          isCancelled: true,
          status: "cancelled",
          statusCategory: "\u5DF2\u53D6\u6D88",
          cancelledBy,
          cancelReason,
          cancelledAt: now,
          timestamp: now,
          // 第二十六轮：给 48 小时清扫器留可识别时戳（与 cancelledAt 兜底双保险）
          updatedAt: now
        };
        if (!dbData["passenger_links"]) dbData["passenger_links"] = {};
        dbData["passenger_links"][assignedDriver] = driverCancelNotice;
        if (!dbData["active_orders"]) dbData["active_orders"] = {};
        dbData["active_orders"][assignedDriver] = driverCancelNotice;
        if (dbData["driver_users"] && dbData["driver_users"][assignedDriver]) {
          dbData["driver_users"][assignedDriver] = {
            ...dbData["driver_users"][assignedDriver],
            isBusy: false,
            lastStatusUpdateTime: now
          };
        }
        if (dbData["driver_locations"] && dbData["driver_locations"][assignedDriver]) {
          dbData["driver_locations"][assignedDriver] = {
            ...dbData["driver_locations"][assignedDriver],
            isBusy: false,
            lastStatusUpdateTime: now
          };
        }
        if (dbData["squad_members"] && dbData["squad_members"][assignedDriver]) {
          dbData["squad_members"][assignedDriver] = {
            ...dbData["squad_members"][assignedDriver],
            isBusy: false,
            lastStatusUpdateTime: now
          };
        }
      }
      writeLocalJsonDb(dbData);
      if (isMySQLEnabled && mysqlPool) {
        try {
          const mergedData = JSON.stringify(dbData["merchant_orders"][orderId]);
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["merchant_orders", orderId, mergedData]
          );
          if (assignedDriver) {
            const cancelNoticeStr = JSON.stringify({
              orderId,
              orderNo: req.body.orderNo || orderId,
              isCancelled: true,
              timestamp: now,
              updatedAt: now,
              status: "cancelled",
              statusCategory: "\u5DF2\u53D6\u6D88",
              cancelledBy,
              cancelReason,
              cancelledAt: now
            });
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["passenger_links", assignedDriver, cancelNoticeStr]
            );
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["active_orders", assignedDriver, cancelNoticeStr]
            );
            for (const col of ["driver_users", "driver_locations", "squad_members"]) {
              try {
                const [drows] = await mysqlPool.query(
                  "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                  [col, assignedDriver]
                );
                if (drows && drows.length > 0) {
                  const dd = typeof drows[0].data === "string" ? JSON.parse(drows[0].data) : drows[0].data;
                  dd.isBusy = false;
                  dd.lastStatusUpdateTime = Date.now();
                  await mysqlPool.query(
                    "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
                    [JSON.stringify(dd), col, assignedDriver]
                  );
                }
              } catch (_) {
              }
            }
          }
        } catch (_) {
        }
      }
      return res.json({ success: true, orderId, order: dbData["merchant_orders"][orderId] });
    } catch (err) {
      console.error("[Order Cancel Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  setInterval(async () => {
    try {
      const now = Date.now();
      let merchantOrders = {};
      let useMySQL = false;
      const dbData = readLocalJsonDb();
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows] = await mysqlQueryTimeout(
            mysqlPool,
            `SELECT \`doc_id\`, \`data\` FROM \`daijia_documents\`
             WHERE \`collection\` = 'merchant_orders'
               AND (
                 JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.status')) = 'dispatched'
                 OR (
                   JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.status')) = 'submitted'
                   AND JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.dispatchedDriverPhone')) NOT IN ('', 'null')
                 )
               )`,
            [],
            8e3,
            "\u5B9A\u65F6\u5668\u626B\u63CF\u6D3E\u5355\u4E2D\u8BA2\u5355"
          );
          (rows || []).forEach((r) => {
            try {
              const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const k = String(r.doc_id || d?.id || d?.orderId || "").trim();
              if (k) merchantOrders[k] = d;
            } catch (_) {
            }
          });
          useMySQL = true;
        } catch (e) {
          console.error("[Timer] MySQL\u8BFBmerchant_orders\u5931\u8D25:", e?.message);
        }
      }
      if (!useMySQL) {
        merchantOrders = dbData["merchant_orders"] || {};
      }
      let hasChanges = false;
      for (const [orderId, order] of Object.entries(merchantOrders)) {
        if (!order) continue;
        const isDispatched = (order.status === "dispatched" || order.status === "submitted" && Boolean(order.dispatchedDriverPhone)) && !order.claimedAt && order.status !== "claimed" && order.status !== "serving" && order.status !== "completed" && order.status !== "cancelled" && order.in_hall !== true;
        if (isDispatched && order.dispatchedDriverPhone) {
          const dispatchedTime = Number(order.dispatchedAt || order.timestamp || now);
          const expiresAt = Number(order.dispatchExpiresAt || dispatchedTime + 6e4);
          let remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1e3));
          if (remainingSec <= 0) {
            try {
              const freshDbData = readLocalJsonDb();
              let freshOrder = freshDbData["merchant_orders"]?.[orderId] || order;
              if (isMySQLEnabled && mysqlPool) {
                try {
                  const [frows] = await mysqlPool.query(
                    "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                    ["merchant_orders", orderId]
                  );
                  if (frows && frows.length > 0) {
                    freshOrder = typeof frows[0].data === "string" ? JSON.parse(frows[0].data) : frows[0].data;
                  }
                } catch (_) {
                }
              }
              const freshStatus = String(freshOrder.status || "");
              if (freshStatus === "claimed" || freshStatus === "serving" || freshStatus === "completed" || freshStatus === "cancelled" || freshOrder.in_hall === true || freshOrder.claimedAt) {
                continue;
              }
              const freshDispatchedTime = Number(freshOrder.dispatchedAt || freshOrder.timestamp || now);
              const freshExpiresAt = Number(freshOrder.dispatchExpiresAt || freshDispatchedTime + 6e4);
              remainingSec = Math.max(0, Math.ceil((freshExpiresAt - now) / 1e3));
              if (remainingSec > 0) {
                order.dispatchExpiresAt = freshOrder.dispatchExpiresAt;
                order.dispatchedAt = freshOrder.dispatchedAt;
              }
            } catch (_) {
            }
          }
          const timedOutDriverPhone = String(order.dispatchedDriverPhone).replace(/\D/g, "").trim();
          if (order.serverCountdown !== remainingSec || order.dispatchCountdown !== remainingSec) {
            order.serverCountdown = remainingSec;
            order.dispatchCountdown = remainingSec;
            if (timedOutDriverPhone && dbData["passenger_links"]?.[timedOutDriverPhone]) {
              dbData["passenger_links"][timedOutDriverPhone].serverCountdown = remainingSec;
              dbData["passenger_links"][timedOutDriverPhone].dispatchCountdown = remainingSec;
            }
          }
          const pageHeartbeatAt = Number(order.pageHeartbeatAt || 0);
          const sinceDispatched = now - dispatchedTime;
          const neverHadHeartbeat = pageHeartbeatAt === 0;
          const pageNotOnScreen = neverHadHeartbeat && sinceDispatched > 35e3;
          if (pageNotOnScreen && remainingSec > 0) {
            console.log(`[\u4E0A\u5C4F\u68C0\u6D4B] \u8BA2\u5355 ${orderId} \u6D3E\u5355${Math.round(sinceDispatched / 1e3)}\u79D2\u65E0\u9875\u9762\u5FC3\u8DF3\uFF0C\u5224\u5B9A\u672A\u4E0A\u5C4F\uFF0C\u7ACB\u5373\u8F6C\u5927\u5385\uFF01`);
            remainingSec = 0;
            order.autoHallReason = "\u65B0\u6765\u5355\u9875\u976235\u79D2\u65E0\u5FC3\u8DF3\uFF0C\u5224\u5B9A\u672A\u4E0A\u5C4F\uFF0C\u670D\u52A1\u5668\u63D0\u524D\u8F6C\u5165\u9009\u5355\u5927\u5385";
          }
          if (remainingSec <= 0) {
            console.log(`[\u963F\u91CC\u4E91\u670D\u52A1\u5668\u5012\u8BA1\u65F6\u7ED3\u675F] \u8BA2\u5355 ${orderId} \u6D3E\u5355\u7ED9\u53F8\u673A ${timedOutDriverPhone} 60\u79D2\u8D85\u65F6\u672A\u786E\u8BA4\uFF0C\u670D\u52A1\u5668\u81EA\u52A8\u8F6C\u5165\u9009\u5355\u5927\u5385\uFF01`);
            const existingDeclined = Array.isArray(order.declinedDriverPhones) ? order.declinedDriverPhones : [];
            const existingTimeout = Array.isArray(order.timeoutDriverPhones) ? order.timeoutDriverPhones : [];
            const updatedOrder = {
              ...order,
              status: "hall",
              in_hall: true,
              statusCategory: "\u547C\u53EB\u4E2D",
              dispatchedDriverPhone: "",
              dispatchedDriverName: "",
              serverCountdown: 0,
              dispatchCountdown: 0,
              declinedDriverPhones: Array.from(new Set([...existingDeclined, timedOutDriverPhone].filter(Boolean))),
              timeoutDriverPhones: Array.from(new Set([...existingTimeout, timedOutDriverPhone].filter(Boolean))),
              lastTimeoutAt: now,
              autoHallAt: now,
              hallAt: now,
              autoHallReason: order.autoHallReason || "60\u79D2\u5012\u8BA1\u65F6\u7ED3\u675F\uFF0C\u4E2D\u56FD\u5927\u9646\u963F\u91CC\u4E91\u670D\u52A1\u5668\u81EA\u52A8\u5C06\u8BA2\u5355\u8F6C\u5165\u9009\u5355\u5927\u5385"
            };
            let hallApplied = true;
            if (isMySQLEnabled && mysqlPool) {
              try {
                const [hallRes] = await mysqlPool.query(
                  "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '') NOT IN ('claimed', '\u5DF2\u63A5\u5355', 'serving', 'completed', 'cancelled', '\u5DF2\u53D6\u6D88', 'hall', '\u7B49\u5F85\u63A5\u5355') AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.in_hall')), 'false') != 'true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.claimedDriverPhone')), '') = ''",
                  [JSON.stringify(updatedOrder), "merchant_orders", orderId]
                );
                hallApplied = Number(hallRes?.affectedRows || 0) > 0;
              } catch (e) {
                console.error(`[Timer] \u8BA2\u5355 ${orderId} \u8F6C\u5927\u5385 MySQL \u6761\u4EF6\u5199\u5165\u5931\u8D25:`, e?.message);
                hallApplied = false;
              }
              if (!hallApplied) {
                console.log(`[Timer] \u8BA2\u5355 ${orderId} \u8F6C\u5927\u5385\u88AB\u5E76\u53D1\u63A5\u5355\u62A2\u5148\uFF08\u6216\u5199\u5165\u5931\u8D25\uFF09\uFF0C\u8DF3\u8FC7`);
                continue;
              }
            }
            merchantOrders[orderId] = updatedOrder;
            hasChanges = true;
            const sweeperActiveDoc = dbData["active_orders"]?.[timedOutDriverPhone];
            const sweeperHasOtherTrip = !!sweeperActiveDoc && String(sweeperActiveDoc.orderId || sweeperActiveDoc.id || "").trim() !== orderId && ["claimed", "arrived", "serving", "\u5DF2\u63A5\u5355", "\u53F8\u673A\u5230\u8FBE", "\u670D\u52A1\u4E2D"].includes(String(sweeperActiveDoc.status || ""));
            if (dbData["passenger_links"] && dbData["passenger_links"][timedOutDriverPhone]) {
              delete dbData["passenger_links"][timedOutDriverPhone];
            }
            if (!sweeperHasOtherTrip && dbData["active_orders"] && dbData["active_orders"][timedOutDriverPhone]) {
              delete dbData["active_orders"][timedOutDriverPhone];
            }
            if (!sweeperHasOtherTrip && dbData["driver_users"] && dbData["driver_users"][timedOutDriverPhone]) {
              dbData["driver_users"][timedOutDriverPhone] = {
                ...dbData["driver_users"][timedOutDriverPhone],
                isBusy: false,
                lastStatusUpdateTime: now
              };
            }
            if (!sweeperHasOtherTrip && dbData["driver_locations"] && dbData["driver_locations"][timedOutDriverPhone]) {
              dbData["driver_locations"][timedOutDriverPhone] = {
                ...dbData["driver_locations"][timedOutDriverPhone],
                isBusy: false,
                lastStatusUpdateTime: now
              };
            }
            if (!sweeperHasOtherTrip && dbData["squad_members"] && dbData["squad_members"][timedOutDriverPhone]) {
              dbData["squad_members"][timedOutDriverPhone] = {
                ...dbData["squad_members"][timedOutDriverPhone],
                isBusy: false,
                lastStatusUpdateTime: now
              };
            }
            if (isMySQLEnabled && mysqlPool) {
              try {
                await mysqlPool.query(
                  "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                  ["passenger_links", timedOutDriverPhone]
                );
                if (!sweeperHasOtherTrip) {
                  await mysqlPool.query(
                    "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                    ["active_orders", timedOutDriverPhone]
                  );
                }
                for (const col of sweeperHasOtherTrip ? [] : ["driver_locations", "driver_users"]) {
                  try {
                    const [drows] = await mysqlPool.query(
                      "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                      [col, timedOutDriverPhone]
                    );
                    if (drows && drows.length > 0) {
                      const dd = typeof drows[0].data === "string" ? JSON.parse(drows[0].data) : drows[0].data;
                      dd.isBusy = false;
                      dd.lastStatusUpdateTime = now;
                      await mysqlPool.query(
                        "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
                        [JSON.stringify(dd), col, timedOutDriverPhone]
                      );
                    }
                  } catch (e) {
                    console.error(`[Timer] \u91CD\u7F6E${col} busy\u72B6\u6001\u5931\u8D25:`, e?.message);
                  }
                }
              } catch (_) {
              }
            }
          }
        }
      }
      if (hasChanges) {
        writeLocalJsonDb(dbData);
      }
    } catch (e) {
    }
  }, 1e4);
  app.post("/api/dispatch/page-heartbeat", requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || req.body?.id || "").trim();
      const driverPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      if (!orderId && !driverPhone) {
        return res.json({ success: false, message: "\u7F3A\u5C11orderId\u6216driverPhone" });
      }
      const now = Date.now();
      if (isMySQLEnabled && mysqlPool && orderId) {
        try {
          await mysqlPool.query(
            'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.pageHeartbeatAt", ?) WHERE `collection` = ? AND (`doc_id` = ? OR JSON_EXTRACT(`data`, "$.id") = ? OR JSON_EXTRACT(`data`, "$.orderId") = ?) AND JSON_UNQUOTE(JSON_EXTRACT(`data`, "$.dispatchedDriverPhone")) = ?',
            [now, "merchant_orders", orderId, orderId, orderId, driverPhone]
          );
          return res.json({ success: true, heartbeatAt: now });
        } catch (e) {
          console.error("[Heartbeat] MySQL\u66F4\u65B0\u5931\u8D25:", e?.message);
        }
      }
      const dbData = readLocalJsonDb();
      let updated = false;
      if (orderId && dbData["merchant_orders"]) {
        for (const [k, v] of Object.entries(dbData["merchant_orders"])) {
          if (v && (v.id === orderId || v.orderId === orderId || v.orderNo === orderId || k === orderId) && String(v.dispatchedDriverPhone || "").replace(/\D/g, "") === driverPhone) {
            v.pageHeartbeatAt = now;
            updated = true;
            break;
          }
        }
      }
      if (driverPhone && dbData["passenger_links"]?.[driverPhone]) {
        dbData["passenger_links"][driverPhone].pageHeartbeatAt = now;
        updated = true;
      }
      if (updated) {
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true, heartbeatAt: now });
    } catch (e) {
      return res.json({ success: false, message: String(e?.message || e) });
    }
  });
  app.get("/api/driver/vip-status", async (req, res) => {
    try {
      const phone = String(req.query.phone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      if (phone === "15509601222") {
        return res.json({ success: true, vipExpiry: "\u6C38\u4E45\u6709\u6548" });
      }
      const purePhone = phone.replace(/A$/, "");
      let vipExpiry = "";
      const vipChain = [
        ["driver_users", phone],
        ["driver_users", purePhone],
        ["squad_members", phone],
        ["squad_members", purePhone]
      ];
      for (const [c, id] of vipChain) {
        const doc = await readCanonicalDocument(c, id).catch(() => null);
        if (doc && doc.vipExpiry) {
          vipExpiry = String(doc.vipExpiry);
          break;
        }
      }
      return res.json({ success: true, vipExpiry });
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  });
  app.get("/api/hubble/authorized_drivers", requireDbAuth, async (req, res) => {
    try {
      const requesterH = String(req.authPhone || "").replace(/\D/g, "");
      if (requesterH !== DEVELOPER_PHONE_SERVER) {
        return res.status(403).json({ success: false, message: "\u4EC5\u5F00\u53D1\u8005\u53EF\u67E5\u770B\u54C8\u52C3\u6388\u6743\u540D\u5355" });
      }
      const dbData = readLocalJsonDb();
      const col = { ...dbData["hubble_authorized_drivers"] || {} };
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [hrows] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["hubble_authorized_drivers"]
          );
          (hrows || []).forEach((r) => {
            try {
              const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              if (d) col[String(r.doc_id)] = d;
            } catch (_) {
            }
          });
        } catch (_) {
        }
      }
      const list = Object.entries(col).filter(([, v]) => !(v && v._revoked)).map(([phone, v]) => ({
        phone,
        name: v?.name || `\u53F8\u673A${phone.slice(-4)}`,
        addedAt: v?.addedAt || Date.now(),
        addedBy: v?.addedBy || "\u5F00\u53D1\u8005"
      }));
      return res.json({ success: true, list });
    } catch (e) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });
  app.post("/api/hubble/authorize", requireDbAuth, async (req, res) => {
    try {
      const requester = String(req.authPhone || "").replace(/\D/g, "");
      if (requester !== "15509601222") {
        return res.status(403).json({ success: false, message: "\u4EC5\u5F00\u53D1\u8005\u53EF\u6388\u6743\u54C8\u52C3\u6743\u9650" });
      }
      const phone = String(req.body?.phone || "").replace(/\D/g, "").trim();
      const name = String(req.body?.name || "").trim() || `\u53F8\u673A${phone.slice(-4)}`;
      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, message: "\u8BF7\u8F93\u516511\u4F4D\u624B\u673A\u53F7" });
      }
      if (phone === "15509601222") {
        return res.status(400).json({ success: false, message: "\u5F00\u53D1\u8005\u9ED8\u8BA4\u62E5\u6709\u6743\u9650\uFF0C\u65E0\u9700\u6388\u6743" });
      }
      const dbData = readLocalJsonDb();
      if (!dbData["hubble_authorized_drivers"]) dbData["hubble_authorized_drivers"] = {};
      dbData["hubble_authorized_drivers"][phone] = {
        phone,
        name,
        addedAt: Date.now(),
        addedBy: requester
      };
      writeLocalJsonDb(dbData);
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["hubble_authorized_drivers", phone, JSON.stringify(dbData["hubble_authorized_drivers"][phone])]
        ).catch(() => {
        });
      }
      try {
        await logAdminOperation("hubble-authorize", requester, phone, "\u6388\u4E88\u54C8\u52C3\u771F\u540D\u67E5\u770B\u6743\u9650", req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });
  app.post("/api/hubble/revoke", requireDbAuth, async (req, res) => {
    try {
      const requester = String(req.authPhone || "").replace(/\D/g, "");
      if (requester !== "15509601222") {
        return res.status(403).json({ success: false, message: "\u4EC5\u5F00\u53D1\u8005\u53EF\u53D6\u6D88\u54C8\u52C3\u6743\u9650" });
      }
      const phone = String(req.body?.phone || "").replace(/\D/g, "").trim();
      if (!phone) {
        return res.status(400).json({ success: false, message: "\u7F3A\u5C11\u624B\u673A\u53F7" });
      }
      const dbData = readLocalJsonDb();
      if (dbData["hubble_authorized_drivers"]?.[phone]) {
        delete dbData["hubble_authorized_drivers"][phone];
        writeLocalJsonDb(dbData);
      }
      if (isMySQLEnabled && mysqlPool) {
        let rowGone = false;
        try {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["hubble_authorized_drivers", phone]
          );
          const [chk] = await mysqlPool.query(
            "SELECT `doc_id` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["hubble_authorized_drivers", phone]
          );
          rowGone = !(chk && chk.length > 0);
        } catch (delErr) {
          console.error("[hubble/revoke] MySQL DELETE \u5931\u8D25\uFF0C\u6539\u8D70\u5893\u7891:", delErr?.message || delErr);
          rowGone = false;
        }
        if (!rowGone) {
          try {
            const tomb = JSON.stringify({ phone, name: "", _revoked: true, revokedAt: Date.now(), revokedBy: requester });
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["hubble_authorized_drivers", phone, tomb]
            );
            const dbData2 = readLocalJsonDb();
            if (!dbData2["hubble_authorized_drivers"]) dbData2["hubble_authorized_drivers"] = {};
            dbData2["hubble_authorized_drivers"][phone] = { phone, name: "", _revoked: true, revokedAt: Date.now(), revokedBy: requester };
            writeLocalJsonDb(dbData2);
          } catch (tombErr) {
            console.error("[hubble/revoke] \u5893\u7891\u5199\u5165\u5931\u8D25:", tombErr?.message || tombErr);
            return res.status(500).json({ success: false, message: "\u64A4\u9500\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
          }
        }
      }
      try {
        await logAdminOperation("hubble-revoke", requester, phone, "\u64A4\u9500\u54C8\u52C3\u771F\u540D\u67E5\u770B\u6743\u9650", req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });
  app.get(["/api/dispatch/countdown", "/api/order/countdown"], requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.query.orderId || req.query.id || req.query.orderNo || "").trim();
      const driverPhone = String(req.query.driverPhone || req.query.phone || "").replace(/\D/g, "").trim();
      const now = Date.now();
      let merchantOrders = {};
      let passengerLinks = {};
      if (isMySQLEnabled && mysqlPool) {
        try {
          let moTargetedHit = false;
          if (orderId) {
            const [oneRow] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["merchant_orders", orderId]
            );
            if (oneRow && oneRow.length > 0) {
              const d = typeof oneRow[0].data === "string" ? JSON.parse(oneRow[0].data) : oneRow[0].data;
              if (d) {
                merchantOrders[orderId] = d;
                moTargetedHit = true;
              }
            }
          }
          if (!moTargetedHit) {
            const [moRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              ["merchant_orders"]
            );
            (moRows || []).forEach((r) => {
              const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const k = String(r.doc_id || d?.id || d?.orderId || "").trim();
              if (k) merchantOrders[k] = d;
            });
          }
          if (driverPhone) {
            const [plRow] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["passenger_links", driverPhone]
            );
            if (plRow && plRow.length > 0) {
              const d = typeof plRow[0].data === "string" ? JSON.parse(plRow[0].data) : plRow[0].data;
              if (d) passengerLinks[driverPhone] = d;
            }
          } else if (!moTargetedHit) {
            const [plRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
              ["passenger_links"]
            );
            (plRows || []).forEach((r) => {
              const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const k = String(r.doc_id || "").trim();
              if (k) passengerLinks[k] = d;
            });
          }
        } catch (_) {
        }
      } else {
        const dbData = readLocalJsonDb();
        merchantOrders = dbData["merchant_orders"] || {};
        passengerLinks = dbData["passenger_links"] || {};
      }
      let targetOrder = null;
      let targetMerchantKey = null;
      if (orderId) {
        targetOrder = merchantOrders[orderId];
        if (targetOrder) {
          targetMerchantKey = orderId;
        } else {
          for (const [k, v] of Object.entries(merchantOrders)) {
            if (v && (v.id === orderId || v.orderId === orderId || v.orderNo === orderId)) {
              targetOrder = v;
              targetMerchantKey = k;
              break;
            }
          }
        }
      }
      if (!targetOrder && driverPhone) {
        const linkOrder = passengerLinks?.[driverPhone];
        if (linkOrder) {
          const linkDispatchedAt = Number(linkOrder.dispatchedAt || linkOrder.timestamp || 0);
          if (!orderId && linkDispatchedAt && Date.now() - linkDispatchedAt > 7e4) {
            console.log(`[Countdown] passenger_links\u65E7\u5355(${Math.round((Date.now() - linkDispatchedAt) / 1e3)}s\u524D)\u62D2\u7EDDfallback\uFF0C\u8D70404`);
          } else {
            const lId = String(linkOrder.id || linkOrder.orderId || linkOrder.orderNo || "").trim();
            if (!orderId || lId && lId === orderId) {
              targetOrder = linkOrder;
              if (!targetMerchantKey) {
                const mk = String(linkOrder?._merchantKey || "").trim();
                if (mk && merchantOrders[mk]) {
                  targetMerchantKey = mk;
                } else {
                  for (const [k, v] of Object.entries(merchantOrders)) {
                    if (v === linkOrder) {
                      targetMerchantKey = k;
                      break;
                    }
                  }
                }
                if (!targetMerchantKey && lId) {
                  for (const [k, v] of Object.entries(merchantOrders)) {
                    if (v && (v.id === lId || v.orderId === lId || v.orderNo === lId || k === lId)) {
                      targetMerchantKey = k;
                      break;
                    }
                  }
                }
              }
              if (targetMerchantKey && merchantOrders[targetMerchantKey]) {
                targetOrder = merchantOrders[targetMerchantKey];
              } else if (targetOrder === linkOrder) {
                console.log(`[Countdown] \u53CD\u67E5merchant_orders\u5931\u8D25\uFF0C\u62D2\u7EDD\u7528stale\u62F7\u8D1D\uFF0C\u8D70404`);
                targetOrder = null;
              }
            }
          }
        }
      }
      if (!targetOrder) {
        return res.status(404).json({
          success: false,
          serverCountdown: 0,
          isExpired: true,
          inHall: false,
          status: "not_found",
          serverTime: now,
          error: "\u8BA2\u5355\u4E0D\u5B58\u5728"
        });
      }
      if (isTerminalOrderFact(targetOrder)) {
        return res.json({
          success: true,
          orderId: targetOrder.id || orderId,
          serverCountdown: 0,
          dispatchCountdown: 0,
          isExpired: true,
          inHall: false,
          status: targetOrder.status,
          statusCategory: targetOrder.statusCategory,
          isCancelled: targetOrder.isCancelled === true || targetOrder.status === "cancelled",
          serverTime: now
        });
      }
      const isClaimedOrActiveForDriver = Boolean(
        targetOrder.claimedDriverPhone && driverPhone && targetOrder.claimedDriverPhone === driverPhone || targetOrder.dispatchedDriverPhone && driverPhone && targetOrder.dispatchedDriverPhone === driverPhone || targetOrder.isDirectClaim === true || targetOrder.status === "claimed" || targetOrder.status === "dispatched" || targetOrder.status === "submitted" || targetOrder.statusCategory === "\u5DF2\u63A5\u5355" || targetOrder.statusCategory === "\u5DF2\u6307\u6D3E"
      );
      const isHall = !isClaimedOrActiveForDriver && (targetOrder.in_hall === true || targetOrder.status === "hall");
      if (isHall) {
        return res.json({
          success: true,
          orderId: targetOrder.id || orderId,
          serverCountdown: 0,
          isExpired: true,
          inHall: true,
          status: targetOrder.status || "hall",
          serverTime: now
        });
      }
      const rawDispatchedAt = Number(targetOrder.dispatchedAt || targetOrder.timestamp || 0);
      const rawExpiresAt = Number(targetOrder.dispatchExpiresAt || 0);
      if (!rawDispatchedAt && !rawExpiresAt) {
        return res.json({
          success: true,
          orderId: targetOrder.id || orderId,
          serverCountdown: 0,
          dispatchCountdown: 0,
          isExpired: true,
          inHall: targetOrder.in_hall === true || targetOrder.status === "hall",
          status: targetOrder.status,
          dispatchedDriverPhone: "",
          serverTime: now,
          dispatchedAt: 0,
          dispatchExpiresAt: 0
        });
      }
      const dispatchedTime = rawDispatchedAt || rawExpiresAt - 6e4;
      let exp = rawExpiresAt || dispatchedTime + 6e4;
      const remainingSec = Math.max(0, Math.ceil((exp - now) / 1e3));
      if (process.env.COUNTDOWN_DEBUG === "1") {
        console.log(`[Countdown] orderId=${targetOrder.id || orderId} driver=${driverPhone} exp=${exp} now=${now} remaining=${remainingSec} status=${targetOrder.status}`);
      }
      const cdReqPhone = String(req.authPhone || "").replace(/\D/g, "");
      const cdInvolved = [targetOrder.dispatchedDriverPhone, targetOrder.claimedDriverPhone, targetOrder.reporterPhone, targetOrder.merchantPhone, targetOrder.passengerPhone].map((v) => String(v || "").replace(/\D/g, "")).filter(Boolean);
      let cdPhoneVisible = Boolean(req.isAdmin) || cdInvolved.includes(cdReqPhone);
      if (!cdPhoneVisible && cdReqPhone) {
        try {
          const cdMship = await getUnifiedMembership(cdReqPhone);
          const cdRole = String(cdMship?.role || "");
          const cdPos = String(cdMship?.squadPosition || "");
          cdPhoneVisible = !!cdMship?.isMember && (["\u57CE\u5E02\u8001\u677F", "\u57CE\u5E02\u7BA1\u7406", "\u57CE\u5E02\u6D3E\u5355\u5458"].some((r) => cdRole.includes(r)) || ["boss", "manager", "dispatcher"].includes(cdPos));
        } catch (_) {
        }
      }
      return res.json({
        success: true,
        orderId: targetOrder.id || orderId,
        serverCountdown: remainingSec,
        dispatchCountdown: remainingSec,
        isExpired: remainingSec <= 0,
        // 2026-10-13修复：inHall 必须反映订单真实状态，不能从 remainingSec 推导。
        // 倒计时到0不代表已进大厅（定时器每10秒才跑一次，可能还没搬）。
        // 此前写成 inHall: remainingSec<=0，导致前端看到假"已进大厅"直接拒单，出现 33→0 跳变。
        inHall: targetOrder.in_hall === true || targetOrder.status === "hall",
        status: targetOrder.status,
        dispatchedDriverPhone: cdPhoneVisible ? targetOrder.dispatchedDriverPhone : "",
        serverTime: now,
        dispatchedAt: dispatchedTime,
        dispatchExpiresAt: exp
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  let lastAutoCleanTimestamp = 0;
  const executeServerAutoClean = async () => {
    console.log("[Auto-Clean] Starting scheduled 2-day disk and cache cleanup at 10:00 AM...");
    try {
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query("PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 2 DAY)");
          console.log("\u2713 [Auto-Clean] Purged MySQL binlogs older than 2 days.");
        } catch (_) {
        }
      }
      const tmpDirs = ["/tmp", import_path.default.join(process.cwd(), "temp_builds")];
      for (const d of tmpDirs) {
        if (import_fs.default.existsSync(d)) {
          try {
            const files = import_fs.default.readdirSync(d);
            for (const f of files) {
              if (f.endsWith(".tmp") || f.endsWith(".zip") || f.startsWith("npm-")) {
                try {
                  const fp = import_path.default.join(d, f);
                  const stat = import_fs.default.statSync(fp);
                  if (Date.now() - stat.mtimeMs > 24 * 3600 * 1e3) {
                    import_fs.default.unlinkSync(fp);
                  }
                } catch (_) {
                }
              }
            }
          } catch (_) {
          }
        }
      }
      const dbData = readLocalJsonDb();
      if (dbData["passenger_links"]) {
        const now = Date.now();
        let changed = false;
        const staleLinkKeys = [];
        for (const [k, v] of Object.entries(dbData["passenger_links"])) {
          const rawT = v?.timestamp ?? v?.updatedAt ?? v?.cancelledAt ?? 0;
          const time = typeof rawT === "number" ? rawT : Date.parse(String(rawT)) || 0;
          if (time > 0 && now - time > 48 * 3600 * 1e3) {
            delete dbData["passenger_links"][k];
            staleLinkKeys.push(k);
            changed = true;
          }
        }
        if (changed) {
          writeLocalJsonDb(dbData);
        }
        if (isMySQLEnabled && mysqlPool && staleLinkKeys.length > 0) {
          try {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` IN (?)",
              ["passenger_links", staleLinkKeys]
            );
          } catch (_) {
          }
        }
      }
      const logPaths = [
        "/www/wwwlogs",
        import_path.default.join(process.env.HOME || "/root", ".pm2/logs"),
        import_path.default.join(process.cwd(), "logs")
      ];
      for (const logDir of logPaths) {
        if (import_fs.default.existsSync(logDir)) {
          try {
            const files = import_fs.default.readdirSync(logDir);
            for (const f of files) {
              if (f.endsWith(".log") || f.endsWith(".err") || f.endsWith(".out")) {
                try {
                  const fp = import_path.default.join(logDir, f);
                  const stat = import_fs.default.statSync(fp);
                  if (stat.size > 10 * 1024 * 1024) {
                    import_fs.default.writeFileSync(fp, `[Log Truncated at ${(/* @__PURE__ */ new Date()).toISOString()} by Auto-Clean]
`, "utf8");
                    console.log(`\u2713 [Auto-Clean] Truncated large log file: ${fp}`);
                  }
                } catch (_) {
                }
              }
            }
          } catch (_) {
          }
        }
      }
      console.log("\u2713 [Auto-Clean] 2-day maintenance completed successfully.");
    } catch (cleanErr) {
      console.error("[Auto-Clean Error]:", cleanErr);
    }
  };
  setTimeout(() => {
    executeServerAutoClean().catch(() => {
    });
  }, 5e3);
  setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjMinute = now.getUTCMinutes();
    const currentDayTime = now.getTime();
    if (bjHour === 10 && bjMinute < 10) {
      if (!lastAutoCleanTimestamp || currentDayTime - lastAutoCleanTimestamp > 40 * 3600 * 1e3) {
        lastAutoCleanTimestamp = currentDayTime;
        await executeServerAutoClean();
      }
    }
  }, 5 * 60 * 1e3);
  app.all(["/api/system/clean-disk", "/api/admin/clean-now"], requireDbAuth, async (req, res) => {
    if (!req.isAdmin) {
      return res.status(403).json({ success: false, error: "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650" });
    }
    await executeServerAutoClean();
    res.json({
      success: true,
      message: "\u2713 \u963F\u91CC\u4E91\u670D\u52A1\u5668\u6E05\u7406\u4E0E\u7626\u8EAB\u4EFB\u52A1\u5DF2\u6210\u529F\u6267\u884C\u5B8C\u6210\uFF01",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.post("/api/db/add", requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || "").trim();
      const data = req.body.data;
      if (!col || data === void 0) {
        return res.status(400).json({ success: false, error: "Missing col or data" });
      }
      if (["squad_members", "squad_applications", "team_members"].includes(col) && !req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u6210\u5458\u4E0E\u7533\u8BF7\u72B6\u6001\u53EA\u80FD\u901A\u8FC7\u4E13\u7528\u63A5\u53E3\u53D8\u66F4", code: "PROTECTED_COLLECTION" });
      }
      if (!req.isAdmin) {
        const ADD_WHITELIST = /* @__PURE__ */ new Set([
          "valet_orders",
          "merchant_orders",
          // 订单类：走正常下单流程
          "driver_locations",
          "driver_users",
          // 司机自有数据
          "squad_applications",
          "online_applications",
          // 申请类
          "system_messages_read",
          "feedback"
          // 反馈/已读
        ]);
        if (!ADD_WHITELIST.has(col)) {
          console.warn(`[Auth] \u62D2\u7EDD\u975E\u767D\u540D\u5355\u96C6\u5408add: token\u624B\u673A=${req.authPhone}, \u96C6\u5408=${col}`);
          return res.status(403).json({ success: false, error: "\u65E0\u6743\u5411\u8BE5\u96C6\u5408\u5199\u5165" });
        }
      }
      if (col === "squad_members" && !req.isAdmin && !req.isManager) {
        const SENSITIVE = ["status", "approvalStatus", "role", "squad_position", "userRole", "position"];
        for (const f of SENSITIVE) {
          if (data && typeof data === "object" && f in data) {
            console.warn(`[Auth] \u5265\u79BB\u654F\u611F\u5B57\u6BB5(add): token\u624B\u673A=${req.authPhone}, \u5B57\u6BB5=${f}`);
            delete data[f];
          }
        }
      }
      if (col === "driver_users" && !req.isAdmin) {
        const STATE_FIELDS_ADD = ["status", "approvalStatus", "role", "userRole", "squad_position", "position", "is_squad_member", "inSquad", "isBanned"];
        for (const f of STATE_FIELDS_ADD) {
          if (data && typeof data === "object" && f in data) delete data[f];
        }
      }
      if (["driver_users", "squad_members", "online_applications", "squad_applications"].includes(col)) {
        for (const f of ["vipExpiry", "licenseExpiry"]) {
          if (data && typeof data === "object" && f in data) {
            console.warn(`[Auth] add\u63A5\u53E3\u5199${f}\u5DF2\u5265\u79BB: token\u624B\u673A=${req.authPhone}, col=${col}`);
            delete data[f];
          }
        }
      }
      if (col === "online_applications" && !req.isAdmin && data && typeof data === "object") {
        for (const f of ["status", "approvalStatus"]) {
          if (f in data) {
            const stV = String(data[f] || "").trim();
            if (!["\u5F85\u5BA1\u6838", "\u5F85\u5BA1\u6279", "pending", "\u672A\u63D0\u4EA4", ""].includes(stV)) {
              console.warn(`[Auth] online_applications ${f} \u81EA\u5199\u5DF2\u5265\u79BB(add): token\u624B\u673A=${req.authPhone}, \u503C=${stV}`);
              delete data[f];
            }
          }
        }
      }
      const generatedId = "doc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
      const dataWithId = { ...data, id: data.id || generatedId };
      const finalId = dataWithId.id;
      if ((col === "driver_users" || col === "driver_locations") && dataWithId.isOnline === true) {
        const writerDigits = normalizeDriverPhoneUnified(req.authPhone);
        if (writerDigits && writerDigits === normalizeDriverPhoneUnified(finalId) && writerDigits !== DEVELOPER_PHONE_SERVER) {
          const removedSetW = await getRemovedSetCached5s();
          if (removedSetW.has(writerDigits)) dataWithId.isOnline = false;
        }
      }
      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(dataWithId);
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          [col, finalId, dataStr]
        );
        try {
          const jdb = readLocalJsonDb();
          if (!jdb[col]) jdb[col] = {};
          jdb[col][finalId] = dataWithId;
          writeLocalJsonDb(jdb);
        } catch (_) {
        }
        return res.json({ success: true, id: finalId });
      }
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      dbData[col][finalId] = dataWithId;
      writeLocalJsonDb(dbData);
      return res.json({ success: true, id: finalId });
    } catch (err) {
      console.error("[DB Proxy ADD Exception]:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.get("/privacy", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u9690\u79C1\u6761\u6B3E\u4E0E\u4E2A\u4EBA\u4FE1\u606F\u4FDD\u62A4\u653F\u7B56</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
      background-color: #f8fafc;
      color: #334155;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .container { max-width: 800px; margin: 24px auto; padding: 24px; }
    .card { background: #ffffff; border-radius: 24px; padding: 32px; border: 1px solid #f1f5f9; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #f1f5f9; margin-bottom: 24px; }
    .header-icon { width: 48px; height: 48px; border-radius: 16px; background: #fff7ed; color: #f97316; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px; }
    .header-badge { font-size: 11px; letter-spacing: 0.1em; color: #94a3b8; font-weight: 800; display: block; margin-bottom: 4px; }
    .header h1 { font-size: 22px; font-weight: 900; color: #0f172a; }
    .header p { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .preamble { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 16px; padding: 16px; margin-bottom: 28px; font-size: 13px; color: #78350f; }
    .preamble-title { font-weight: 800; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #451a03; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 800; color: #1e293b; border-left: 4px solid #f97316; padding-left: 10px; margin-bottom: 12px; }
    .section p { font-size: 13px; color: #64748b; margin-bottom: 8px; }
    .section b { color: #334155; }
    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 antialiased selection:bg-orange-100 flex flex-col min-h-screen">
  <div class="container">
    <div class="card space-y-8">
      
      <!-- Top header with lock icon -->
      <div class="flex flex-col items-center text-center gap-2 pb-6 border-b border-slate-100">
        <div class="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 mb-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <span class="text-xs uppercase tracking-widest text-slate-400 font-extrabold">PRIVACY POLICY</span>
        <h1 class="text-xl md:text-2xl font-black text-slate-900">\u9690\u79C1\u6761\u6B3E\u4E0E\u4E2A\u4EBA\u4FE1\u606F\u4FDD\u62A4\u653F\u7B56</h1>
        <p class="text-xs text-slate-400 mt-1">\u66F4\u65B0\u65E5\u671F\uFF1A2026\u5E747\u670814\u65E5</p>
      </div>

      <!-- Core Summary Preamble -->
      <div class="bg-amber-50/60 border border-amber-100 rounded-2xl p-4 md:p-5 text-amber-900 text-xs md:text-[13px] leading-relaxed space-y-2 text-left">
        <p class="font-extrabold flex items-center gap-1.5 text-amber-950">
          <svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          \u6838\u5FC3\u6458\u8981\u4E0E\u98CE\u9669\u63D0\u793A\uFF1A
        </p>
        <p>
          \u4E3A\u4FDD\u969C\u60A8\u7684\u4E2A\u4EBA\u9690\u79C1\u4E0E\u5408\u6CD5\u6743\u76CA\uFF0C\u6211\u4EEC\u7279\u6839\u636E\u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u4E2A\u4EBA\u4FE1\u606F\u4FDD\u62A4\u6CD5\u300B\u7B49\u6CD5\u5F8B\u6CD5\u89C4\u5236\u5B9A\u672C\u653F\u7B56\u3002\u672C\u5E73\u53F0\u6536\u96C6\u7684\u624B\u673A\u53F7\u3001GPS\u5B9A\u4F4D\u3001\u8EAB\u4EFD\u4FE1\u606F\u53CA\u9A7E\u9A76\u8D44\u8D28\u4E3A\u63D0\u4F9B<b>\u6838\u5FC3\u53EB\u5355\u3001\u884C\u8F66\u5B89\u5168\u3001\u5C45\u95F4\u5339\u914D\u3001\u4EE3\u9A7E\u8D44\u8D28\u6838\u9A8C</b>\u6240\u7EDD\u5BF9\u5FC5\u9700\u3002\u6211\u4EEC\u90D1\u91CD\u627F\u8BFA\uFF0C\u7EDD\u4E0D\u5C06\u60A8\u7684\u4E2A\u4EBA\u654F\u611F\u4FE1\u606F\u6CC4\u9732\u6216\u6EE5\u7528\u3002\u540C\u65F6\uFF0C\u672C\u653F\u7B56\u4E2D\u5305\u542B\u4E86\u591A\u9879<b>\u5E73\u53F0\u514D\u8D23\u53CA\u7B2C\u4E09\u65B9SDK\uFF08\u5982\u5730\u56FE\u3001\u77ED\u4FE1\uFF09\u670D\u52A1\u514D\u8D23\u6761\u6B3E</b>\uFF0C\u8BF7\u60A8\u52A1\u5FC5\u4ED4\u7EC6\u9605\u8BFB\u4EE5\u4E86\u89E3\u60A8\u7684\u6743\u76CA\u8303\u56F4\u3002
        </p>
      </div>

      <!-- Detail sections -->
      <div class="space-y-6 text-slate-600 text-xs md:text-sm leading-relaxed text-left">
        
        <!-- Section 1 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E00\u6761 \u4E2A\u4EBA\u4FE1\u606F\u6536\u96C6\u4E0E\u6388\u6743\u8303\u56F4
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-medium text-slate-700">
              \u5728\u60A8\u4F7F\u7528\u9ED1\u6E7E\u4EE3\u9A7E\u670D\u52A1\uFF08\u5305\u62EC\u53EB\u5355\u3001\u67E5\u770B\u8DEF\u7EBF\u3001\u7533\u8BF7\u6210\u4E3A\u4EE3\u9A7E\u53F8\u673A\u7B49\uFF09\u8FC7\u7A0B\u4E2D\uFF0C\u6211\u4EEC\u5C06\u672C\u7740\u201C\u5408\u6CD5\u3001\u6B63\u5F53\u3001\u5FC5\u8981\u548C\u8BDA\u4FE1\u201D\u539F\u5219\u6536\u96C6\u3001\u4F7F\u7528\u3001\u5B58\u50A8\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\uFF0C\u7528\u9014\u5982\u4E0B\uFF1A
            </p>
            <p>
              1. <b>\u8D26\u53F7\u6CE8\u518C\u3001\u767B\u5F55\u4E0E\u5B89\u5168\u6821\u9A8C</b>\uFF1A\u6211\u4EEC\u5C06\u6536\u96C6\u60A8\u7684<b>\u624B\u673A\u53F7\u7801</b>\u3002\u8BE5\u4FE1\u606F\u7528\u4E8E\u4E3A\u60A8\u5EFA\u7ACB\u7528\u6237\u6863\u6848\u3001\u4E0B\u53D1\u9A8C\u8BC1\u7801\u3001\u63D0\u4F9B\u5BA2\u670D\u652F\u6301\u3002
            </p>
            <p>
              2. <b>\u7CBE\u51C6\u5B9A\u4F4D\u4E0E\u884C\u8F66\u5B89\u5168\u670D\u52A1</b>\uFF1A\u5F53\u60A8\u5728\u524D\u7AEF\u53EB\u5355\u6216\u5728\u53F8\u673A\u542C\u5355\u6A21\u5F0F\u4E0B\uFF0C\u6211\u4EEC\u9700\u8981\u6536\u96C6\u3001\u4F7F\u7528\u60A8\u7684<b>\u7CBE\u51C6GPS\u5730\u7406\u4F4D\u7F6E\u4FE1\u606F\u3001\u884C\u9A76\u8F68\u8FF9\u3001\u8D77\u70B9\u548C\u7EC8\u70B9</b>\u3002\u8FD9\u662F\u8BA1\u7B97\u884C\u7A0B\u91CC\u7A0B\u3001\u8FDB\u884C\u7CBE\u786E\u8F66\u8D39\u7ED3\u7B97\u3001\u5411\u60A8\u63A8\u8350\u5C31\u8FD1\u53F8\u673A\u3001\u5728\u9014\u8DEF\u7EBF\u8FFD\u8E2A\u3001\u4FDD\u969C\u884C\u8F66\u4EBA\u8EAB\u5B89\u5168\u7684\u6838\u5FC3\u6280\u672F\u624B\u6BB5\u3002\u82E5\u60A8\u62D2\u7EDD\u6388\u6743\uFF0C\u5C06\u65E0\u6CD5\u4F7F\u7528\u672C\u5E73\u53F0\u7684\u5730\u56FE\u6838\u5FC3\u53EB\u5355\u529F\u80FD\u3002
            </p>
            <p>
              3. <b>\u670D\u52A1\u4EBA\u5458\uFF08\u53F8\u673A\uFF09\u8D44\u8D28\u6838\u9A8C\u4E0E\u80CC\u666F\u5BA1\u67E5</b>\uFF1A\u5982\u679C\u60A8\u7533\u8BF7\u6CE8\u518C\u6210\u4E3A\u4EE3\u9A7E\u670D\u52A1\u4EBA\u5458\uFF0C\u6839\u636E\u4E2D\u56FD\u6CD5\u5F8B\u5173\u4E8E\u516C\u5171\u9053\u8DEF\u8FD0\u8F93\u3001\u7F51\u7EA6\u3001\u4EE3\u9A7E\u884C\u4E1A\u7684\u5408\u89C4\u8981\u6C42\uFF0C\u6211\u4EEC\u5FC5\u987B\u6536\u96C6\u60A8\u7684<b>\u771F\u5B9E\u59D3\u540D\u3001\u8EAB\u4EFD\u8BC1\u53F7\u7801\u3001\u8EAB\u4EFD\u8BC1\u6B63\u53CD\u9762\u7167\u7247\u3001\u9A7E\u9A76\u8BC1\u6B63\u526F\u9875\u7167\u7247\u3001\u51C6\u9A7E\u8F66\u578B\u53CA\u9886\u8BC1\u65E5\u671F</b>\u3002\u8FD9\u4E9B\u4FE1\u606F\u4EC5\u7528\u4E8E\u80CC\u666F\u5B89\u5168\u5BA1\u67E5\u3001\u6838\u67E5\u65E0\u72AF\u7F6A\u8BB0\u5F55\u3001\u9A8C\u8BC1\u9A7E\u9A76\u8BC1\u6709\u6548\u6027\u53CA\u6392\u9664\u5371\u9669\u9A7E\u9A76\u503E\u5411\uFF0C\u4E0D\u4F5C\u4ED6\u7528\u3002\u5982\u60A8\u4E0D\u63D0\u4F9B\uFF0C\u672C\u5E73\u53F0\u6709\u6743\u62D2\u7EDD\u60A8\u7684\u6CE8\u518C\u7533\u8BF7\u3002
            </p>
            <p>
              4. <b>\u7D27\u6025\u60C5\u51B5\u6551\u52A9\u4FDD\u969C</b>\uFF1A\u5728\u6CE8\u518C\u53F8\u673A\u6216\u53EB\u5355\u65F6\uFF0C\u6211\u4EEC\u5141\u8BB8\u60A8\u586B\u5199<b>\u7D27\u6025\u8054\u7CFB\u4EBA\u59D3\u540D\u53CA\u7535\u8BDD</b>\u3002\u6211\u4EEC\u4EC5\u5728\u6781\u7AEF\u7A81\u53D1\u72B6\u51B5\uFF08\u5982\u4EA4\u901A\u4E8B\u6545\u3001\u4EBA\u8EAB\u5371\u9669\u3001\u7D27\u6025\u5931\u8054\uFF09\u4E0B\u62E8\u6253\u8BE5\u7535\u8BDD\uFF0C\u4EE5\u6700\u5927\u53EF\u80FD\u7EF4\u62A4\u60A8\u751F\u547D\u8D22\u4EA7\u5B89\u5168\u3002
            </p>
          </div>
        </div>

        <!-- Section 2 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E8C\u6761 \u4FE1\u606F\u7684\u5B58\u50A8\u671F\u9650\u4E0E\u5B89\u5168\u9632\u5FA1
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>\u672C\u5730\u5B58\u50A8\u4E0E\u8DE8\u5883</b>\uFF1A\u6211\u4EEC\u5728\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u5883\u5185\u6536\u96C6\u548C\u4EA7\u751F\u7684\u4E2A\u4EBA\u4FE1\u606F\u5C06<b>\u5B58\u50A8\u5728\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u5883\u5185</b>\u3002\u9664\u975E\u6709\u4E2D\u56FD\u6CD5\u5F8B\u6CD5\u89C4\u7684\u660E\u786E\u6388\u6743\u6216\u653F\u5E9C\u884C\u653F\u3001\u53F8\u6CD5\u673A\u5173\u7684\u8981\u6C42\uFF0C\u6211\u4EEC\u4E0D\u4F1A\u5C06\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u4F20\u8F93\u81F3\u5883\u5916\u3002
            </p>
            <p>
              2. <b>\u5B58\u50A8\u671F\u9650</b>\uFF1A\u6211\u4EEC\u4EC5\u5728\u63D0\u4F9B\u672C\u5E73\u53F0\u670D\u52A1\u6240\u5FC5\u9700\u7684\u671F\u9650\u5185\u4FDD\u7559\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u3002\u5728\u60A8\u6CE8\u9500\u8D26\u53F7\u6216\u5220\u9664\u4E2A\u4EBA\u4FE1\u606F\u540E\uFF0C\u6211\u4EEC\u5C06\u5728\u6CD5\u5F8B\u8981\u6C42\u7684\u5408\u7406\u4FDD\u7559\u671F\uFF08\u5982\u300A\u7535\u5B50\u5546\u52A1\u6CD5\u300B\u8981\u6C42\u7684\u4EA4\u6613\u4FE1\u606F\u4FDD\u7559\u4E0D\u5C11\u4E8E\u4E09\u5E74\uFF09\u5C4A\u6EE1\u540E\u5BF9\u60A8\u7684\u4FE1\u606F\u8FDB\u884C\u5220\u9664\u6216\u533F\u540D\u5316\u5904\u7406\u3002
            </p>
            <p>
              3. <b>\u6280\u672F\u5B89\u5168\u9632\u62A4\u63AA\u65BD</b>\uFF1A\u672C\u5E73\u53F0\u91C7\u7528\u7B26\u5408\u4E1A\u754C\u6807\u51C6\u7684\u5B89\u5168\u9632\u62A4\u63AA\u65BD\u3001\u6570\u636E\u52A0\u5BC6\u4F20\u8F93\uFF08\u5982 HTTPS\u3001TLS \u534F\u8BAE\uFF09\u548C\u5B58\u50A8\u52A0\u5BC6\uFF08\u5BF9\u8EAB\u4EFD\u8BC1\u53F7\u3001\u624B\u673A\u53F7\u91C7\u7528\u9AD8\u5F3A\u5EA6\u5355\u5411\u54C8\u5E0C\u6216\u5BF9\u79F0\u52A0\u5BC6\u8131\u654F\u5B58\u50A8\uFF09\uFF0C\u4E25\u683C\u9632\u8303\u4ED6\u4EBA\u672A\u7ECF\u6388\u6743\u8BBF\u95EE\u3001\u4FEE\u6539\u3001\u6CC4\u9732\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u3002
            </p>
          </div>
        </div>

        <!-- Section 3 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E09\u6761 \u5E73\u53F0\u6CD5\u5F8B\u8D23\u4EFB\u8C41\u514D\u4E0E\u98CE\u9669\u9632\u8303\uFF08\u91CD\u8981\uFF09
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-semibold text-slate-700">
              \u4E3A\u4E86\u4FDD\u969C\u672C\u5E73\u53F0\u7684\u6B63\u5E38\u3001\u5408\u89C4\u8FD0\u8F6C\uFF0C\u5E76\u59A5\u5584\u5398\u6E05\u5404\u65B9\u7684\u6CD5\u5F8B\u8D23\u4EFB\u8FB9\u754C\uFF0C\u7279\u7EA6\u5B9A\u5982\u4E0B\u514D\u8D23\u4E0E\u98CE\u9669\u5206\u6563\u673A\u5236\uFF1A
            </p>
            <p>
              1. <b>\u7B2C\u4E09\u65B9\u7EC4\u4EF6\uFF08SDK\uFF09\u72EC\u7ACB\u8D23\u4EFB\u8C41\u514D</b>\uFF1A
              \u672C\u5E73\u53F0\u7684\u6838\u5FC3\u5B9A\u4F4D\u3001\u5730\u56FE\u5C55\u793A\u3001\u8DEF\u5F84\u89C4\u5212\u53CA\u77ED\u4FE1\u53D1\u9001\u5206\u522B\u96C6\u6210\u4E86\u7B2C\u4E09\u65B9\u4F9B\u5E94\u5546 of \u6210\u719F\u4EA7\u54C1\uFF08\u5982\uFF1A\u817E\u8BAF\u5730\u56FE SDK\u3001\u963F\u91CC\u4E91/\u817E\u8BAF\u4E91\u77ED\u4FE1\u670D\u52A1\uFF09\u3002\u8FD9\u4E9B\u7B2C\u4E09\u65B9\u670D\u52A1\u4E3A\u63D0\u4F9B\u5176\u7279\u5B9A\u529F\u80FD\uFF0C\u5C06\u72EC\u7ACB\u6536\u96C6\u548C\u5904\u7406\u60A8\u7684\u7F51\u7EDC\u72B6\u6001\u3001IP\u53CA\u8BBE\u5907\u6807\u8BC6\u7B49\u3002<b>\u672C\u5E73\u53F0\u5DF2\u5728\u5408\u7406\u5546\u4E1A\u9650\u5EA6\u5185\u5BF9\u670D\u52A1\u5546\u7684\u5B89\u5168\u5408\u89C4\u60C5\u51B5\u8FDB\u884C\u4E86\u5BA1\u6838\uFF0C\u56E0\u7B2C\u4E09\u65B9\u7CFB\u7EDF\u6F0F\u6D1E\u3001\u672A\u6388\u6743\u7BE1\u6539\u3001\u6216\u4E0D\u53EF\u6297\u62D2\u6280\u672F\u6CE2\u52A8\u5F15\u53D1\u7684\u4E2A\u4EBA\u6570\u636E\u6CC4\u9732\uFF0C\u5E73\u53F0\u5728\u6CD5\u5F8B\u5141\u8BB8\u7684\u6700\u5927\u8303\u56F4\u5185\u4E0D\u5BF9\u7B2C\u4E09\u65B9\u7684\u72EC\u7ACB\u4FB5\u6743\u884C\u4E3A\u627F\u62C5\u76F4\u63A5\u53CA\u8FDE\u5E26\u8D54\u507F\u8D23\u4EFB\u3002</b>
            </p>
            <p>
              2. <b>\u5C45\u95F4\u64AE\u5408\u4E0E\u6CD5\u5F8B\u5173\u7CFB\u72EC\u7ACB\u6027</b>\uFF1A
              \u672C\u5E73\u53F0\u63D0\u4F9B\u7684\u662F\u6280\u672F\u4FE1\u606F\u53D1\u5E03\u4E0E\u5C45\u95F4\u5339\u914D\u670D\u52A1\u3002\u4EE3\u9A7E\u53F8\u673A\u4E0E\u4E58\u5BA2\u4E4B\u95F4\u72EC\u7ACB\u5F62\u6210\u4EE3\u9A7E\u670D\u52A1\u5408\u540C\u5173\u7CFB\u3002\u5728\u670D\u52A1\u5C65\u884C\u671F\u95F4\uFF08\u4ECE\u53F8\u673A\u63A5\u8F66\u5F00\u59CB\u81F3\u5B89\u5168\u505C\u9760\u4EA4\u8F66\u5B8C\u6BD5\uFF09\uFF0C\u5982\u56E0\u9053\u8DEF\u7A81\u53D1\u8F66\u7978\u3001\u8D22\u4EA7\u9057\u5931\u3001\u4E09\u65B9\u4FB5\u6743\u7B49\u539F\u56E0\u906D\u53D7\u635F\u5931\u7684\uFF0C<b>\u5E94\u9996\u5148\u7531\u5404\u65B9\u7684\u627F\u8FD0\u9669\u3001\u8F66\u8F86\u4EA4\u5F3A\u9669\u53CA\u5546\u4E1A\u9669\u6216\u53F8\u4E58\u4E2A\u4EBA\u4FDD\u9669\u8FDB\u884C\u7406\u8D54</b>\u3002\u672C\u5E73\u53F0\u4F9D\u6CD5\u5EFA\u7ACB\u5065\u5168\u5E73\u53F0\u5B89\u5168\u7BA1\u7406\u5236\u5EA6\u4E0E\u8D44\u8D28\u5BA1\u6838\uFF0C\u4F46\u9664\u6CD5\u5F8B\u660E\u6587\u89C4\u5B9A\u7684\u4E25\u91CD\u5BA1\u6838\u5931\u804C\u3001\u5E73\u53F0\u6545\u610F\u8FC7\u9519\u7B49\u6CD5\u5B9A\u8D23\u4EFB\u5916\uFF0C\u4E0D\u5BF9\u53F8\u673A\u6216\u4E58\u5BA2\u5728\u670D\u52A1\u8FC7\u7A0B\u4E2D\u7684\u5355\u65B9\u8FDD\u7EA6\u3001\u8FC7\u5931\u4FB5\u6743\u3001\u4EA4\u901A\u8FDD\u6CD5\u7F5A\u6B3E\u6216\u4EBA\u8EAB\u635F\u5BB3\u7B49\u627F\u62C5\u8FDE\u5E26\u8D54\u507F\u548C\u5408\u540C\u4FDD\u5E95\u8D23\u4EFB\u3002
            </p>
            <p>
              3. <b>\u7528\u6237\u8D26\u53F7\u51ED\u8BC1\u4FDD\u7BA1\u4E49\u52A1</b>\uFF1A
              \u77ED\u4FE1\u9A8C\u8BC1\u7801\u3001\u767B\u5F55\u51ED\u8BC1\u662F\u60A8\u8BBF\u95EE\u672C\u5E73\u53F0\u7684\u552F\u4E00\u6570\u5B57\u6807\u8BC6\u3002\u4EFB\u4F55\u7531\u4E8E\u60A8<b>\u4E3B\u52A8\u6216\u8FC7\u5931\u5C06\u9A8C\u8BC1\u7801\u6CC4\u9732\u7ED9\u7B2C\u4E09\u65B9\u3001\u624B\u673A\u4E0D\u614E\u9057\u5931\u800C\u88AB\u4ED6\u4EBA\u5192\u7528\u3001\u672A\u53CA\u65F6\u7533\u8BF7\u6302\u5931\u3001\u6216\u906D\u9047\u4E2A\u4EBA\u7EC8\u7AEF\u75C5\u6BD2\u6728\u9A6C\u611F\u67D3</b>\u800C\u5BFC\u81F4\u7684\u8EAB\u4EFD\u6CC4\u9732\u3001\u7533\u8BF7\u8D44\u6599\u88AB\u7BE1\u6539\u3001\u8D22\u4EA7\u906D\u53D7\u635F\u5931\u7684\u60C5\u5F62\uFF0C\u5176\u4E0D\u5229\u6CD5\u5F8B\u540E\u679C\u5E94\u7531\u60A8\u81EA\u884C\u627F\u62C5\u3002
            </p>
            <p>
              4. <b>\u6280\u672F\u4E0E\u4E0D\u53EF\u6297\u529B\u514D\u8D23</b>\uFF1A
              \u9274\u4E8E\u4E92\u8054\u7F51\u65E0\u7EBF\u901A\u4FE1\u6280\u672F\u7684\u7279\u6B8A\u6027\uFF0C\u906D\u9047\u9ED1\u5BA2\u653B\u51FB\u3001\u7535\u4FE1\u8FD0\u8425\u5546\u57FA\u7AD9\u6545\u969C\u3001\u536B\u661F\u5B9A\u4F4D\u4FE1\u53F7\u76F2\u533A\u3001\u653F\u5E9C\u7BA1\u5236\u547D\u4EE4\u3001\u81EA\u7136\u707E\u5BB3\u7B49\u5BFC\u81F4\u7684\u5B9A\u4F4D\u504F\u5DEE\u3001\u7CFB\u7EDF\u5361\u987F\u3001\u6D88\u606F\u5EF6\u8FDF\u53D1\u9001\u6216\u6570\u636E\u90E8\u5206\u4E22\u5931\uFF0C\u5E73\u53F0\u5C06\u5C3D\u529B\u534F\u52A9\u6551\u63F4\u5E76\u6062\u590D\uFF0C\u4F46\u5728\u6CD5\u5F8B\u5141\u8BB8\u9650\u5EA6\u5185\u514D\u4E8E\u627F\u62C5\u8FDD\u7EA6\u4E0E\u8D54\u507F\u8FDE\u5E26\u8D23\u4EFB\u3002
            </p>
          </div>
        </div>

        <!-- Section 4 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u56DB\u6761 \u4E2A\u4EBA\u4FE1\u606F\u7BA1\u7406\u6743\u5229
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              \u6839\u636E\u4E2D\u56FD\u6CD5\u5F8B\u89C4\u5B9A\uFF0C\u60A8\u5BF9\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u4EAB\u6709\u5408\u6CD5\u7684\u63A7\u5236\u6743\uFF0C\u5177\u4F53\u5305\u62EC\uFF1A
            </p>
            <p>
              1. <b>\u67E5\u8BE2\u4E0E\u66F4\u6B63</b>\uFF1A\u60A8\u6709\u6743\u8BBF\u95EE\u60A8\u7684\u4E2A\u4EBA\u8D44\u6599\u53CA\u6CE8\u518C\u53F8\u673A\u8D44\u6599\u3002\u82E5\u4FE1\u606F\u53D1\u751F\u53D8\u5316\u6216\u53D1\u73B0\u6709\u8BEF\uFF0C\u60A8\u53EF\u4EE5\u968F\u65F6\u4FEE\u6539\u3002
            </p>
            <p>
              2. <b>\u64A4\u56DE\u540C\u610F</b>\uFF1A\u60A8\u53EF\u4EE5\u968F\u65F6\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u5173\u95ED\u4F4D\u7F6E\u5B9A\u4F4D\u6743\u9650\u3001\u901A\u77E5\u6743\u9650\uFF0C\u64A4\u56DE\u5BF9\u76F8\u5E94\u6570\u636E\u7684\u7EE7\u7EED\u6536\u96C6\u3002\u64A4\u56DE\u4E0D\u5F71\u54CD\u5728\u6B64\u4E4B\u524D\u57FA\u4E8E\u60A8\u540C\u610F\u5DF2\u8FDB\u884C\u7684\u4FE1\u606F\u5904\u7406\u3002
            </p>
            <p>
              3. <b>\u6CE8\u9500\u8D26\u53F7</b>\uFF1A\u82E5\u60A8\u4E0D\u9700\u8981\u7EE7\u7EED\u4F7F\u7528\u672C\u5E73\u53F0\u670D\u52A1\uFF0C\u60A8\u53EF\u4EE5\u8054\u7CFB\u5BA2\u670D\u7533\u8BF7\u6CE8\u9500\u3002\u6211\u4EEC\u5C06\u5728\u6838\u9A8C\u8D26\u6237\u5B89\u5168\u540E\u4E3A\u60A8\u5F7B\u5E95\u5220\u9664\u6240\u6709\u5173\u8054\u6570\u636E\u6216\u8FDB\u884C\u4E0D\u53EF\u9006\u7684\u533F\u540D\u5316\u3002
            </p>
          </div>
        </div>

        <!-- Section 5 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E94\u6761 \u6761\u6B3E\u66F4\u65B0\u4E0E\u9002\u7528\u6CD5\u5F8B
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>\u653F\u7B56\u8C03\u6574\u516C\u544A</b>\uFF1A\u672C\u300A\u9690\u79C1\u653F\u7B56\u300B\u5C06\u6839\u636E\u5927\u9646\u6CD5\u5F8B\u653F\u7B56\u52A8\u6001\u3001\u672C\u5E73\u53F0\u670D\u52A1\u5347\u7EA7\u7B49\u60C5\u51B5\u8FDB\u884C\u4FEE\u8BA2\u3002\u4E00\u65E6\u8FDB\u884C\u4FEE\u6539\uFF0C\u6211\u4EEC\u5C06\u901A\u8FC7\u672C\u8F6F\u4EF6\u5F39\u7A97\u3001\u516C\u544A\u7B49\u5408\u7406\u5F62\u5F0F\u544A\u77E5\u3002\u82E5\u60A8\u5728\u4FEE\u8BA2\u540E\u7EE7\u7EED\u4F7F\u7528\uFF0C\u5373\u89C6\u4E3A\u60A8\u5B8C\u5168\u9605\u8BFB\u5E76\u7406\u89E3\u65B0\u7248\u9690\u79C1\u653F\u7B56\u3002
            </p>
            <p>
              2. <b>\u7BA1\u8F96\u4E0E\u4E89\u8BAE\u89E3\u51B3</b>\uFF1A\u672C\u653F\u7B56\u7684\u6210\u7ACB\u3001\u751F\u6548\u3001\u5C65\u884C\u3001\u89E3\u91CA\u53CA\u4E89\u8BAE\u89E3\u51B3\u5747\u9002\u7528<b>\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u5927\u9646\u5730\u533A\u6CD5\u5F8B</b>\u3002\u82E5\u56E0\u672C\u653F\u7B56\u4EA7\u751F\u4EFB\u4F55\u4E89\u8BAE\uFF0C\u53CC\u65B9\u5E94\u9996\u5148\u53CB\u597D\u534F\u5546\u89E3\u51B3\uFF1B\u534F\u5546\u4E0D\u6210\u7684\uFF0C\u4EFB\u4F55\u4E00\u65B9\u5747\u6709\u6743\u5411<b>\u672C\u5E73\u53F0\u8FD0\u8425\u65B9\u6240\u5728\u5730\u6709\u7BA1\u8F96\u6743\u7684\u4EBA\u6C11\u6CD5\u9662\u63D0\u8D77\u8BC9\u8BBC</b>\u3002
            </p>
          </div>
        </div>

      </div>

      <!-- Footer action button -->
      <div class="pt-6 border-t border-slate-100 flex justify-center">
        <button onclick="window.close()" class="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition-all active:scale-95 shadow-lg shadow-slate-100 flex items-center gap-2 cursor-pointer">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          \u5173\u95ED\u6B64\u9875\u9762
        </button>
      </div>

    </div>
  </div>

  <footer class="py-6 text-center text-xs text-slate-400 border-t border-slate-100 bg-white shrink-0">
    <p>\u53F8\u673A\u6CE8\u518C\u5E73\u53F0 \xB7 \u5B89\u5168\u5408\u89C4\u670D\u52A1 \xB7 \xA9 2026 \u7248\u6743\u6240\u6709</p>
  </footer>
</body>
</html>
    `);
  });
  app.get("/9fe449b6d3069a0e1d9157132374017a.txt", (req, res) => {
    res.type("text/plain").send("9496c3005dc6f9c8dcab74dca7ad82028a77e765");
  });
  app.get("/api/download-dist", async (req, res) => {
    if (!await verifyDeveloperDownload(req)) {
      return res.status(403).json({ success: false, error: "\u90E8\u7F72\u5305\u4E0B\u8F7D\u9700\u8981\u5F00\u53D1\u8005\u767B\u5F55" });
    }
    const filePath = import_path.default.join(process.cwd(), "dist.zip");
    res.download(filePath, "dist.zip", (err) => {
      if (err) {
        console.error("[Download Error] dist.zip serving failed:", err);
        if (!res.headersSent) {
          const tarPath = import_path.default.join(process.cwd(), "dist.tar.gz");
          res.download(tarPath, "dist.tar.gz", (err2) => {
            if (err2) {
              res.status(404).send("Neither dist.zip nor dist.tar.gz was found on server. Please build first.");
            }
          });
        }
      }
    });
  });
  app.get("/api/download-dist-tar", async (req, res) => {
    if (!await verifyDeveloperDownload(req)) {
      return res.status(403).json({ success: false, error: "\u90E8\u7F72\u5305\u4E0B\u8F7D\u9700\u8981\u5F00\u53D1\u8005\u767B\u5F55" });
    }
    const filePath = import_path.default.join(process.cwd(), "dist.tar.gz");
    res.download(filePath, "dist.tar.gz", (err) => {
      if (err) {
        console.error("[Download Error] dist.tar.gz serving failed:", err);
        if (!res.headersSent) {
          res.status(404).send("dist.tar.gz not found on server. Please build first.");
        }
      }
    });
  });
  app.options("/api/tts", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });
  app.post("/api/sms/send", async (req, res) => {
    const { phone, isAdminLogin, scope } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u7801\u4E0D\u80FD\u4E3A\u7A7A" });
    }
    const cleanPhone = String(phone).trim();
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: "\u8BF7\u8F93\u5165\u6B63\u786E\u768411\u4F4D\u624B\u673A\u53F7\u7801" });
    }
    const SMS_UNLIMITED_PHONES = /* @__PURE__ */ new Set(["15509601222", "15121904440", "18695119126"]);
    const isSmsUnlimited = SMS_UNLIMITED_PHONES.has(cleanPhone);
    if (!isSmsUnlimited) {
      const clientIp = getClientIp(req);
      const now = Date.now();
      const keyPhone = `p:${cleanPhone}`;
      const keyIp = `ip:${clientIp}`;
      const pendingLogs = [];
      for (const key of [keyPhone, keyIp]) {
        const logs = (smsSendLogs.get(key) || []).filter((t) => now - t < 3600 * 1e3);
        if (logs.length >= 5) {
          return res.status(429).json({ success: false, error: "\u274C \u53D1\u9001\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF71\u5C0F\u65F6\u540E\u518D\u8BD5" });
        }
        if (logs.length > 0 && now - logs[logs.length - 1] < 60 * 1e3) {
          const waitSec = Math.ceil((60 * 1e3 - (now - logs[logs.length - 1])) / 1e3);
          return res.status(429).json({ success: false, error: `\u274C \u53D1\u9001\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7 ${waitSec} \u79D2\u540E\u518D\u8BD5` });
        }
        pendingLogs.push([key, logs]);
      }
      for (const [key, logs] of pendingLogs) {
        logs.push(now);
        smsSendLogs.set(key, logs);
      }
      if (smsSendLogs.size > 5e3) {
        for (const [k, v] of smsSendLogs) {
          const fresh = v.filter((t) => now - t < 3600 * 1e3);
          if (fresh.length === 0) smsSendLogs.delete(k);
          else smsSendLogs.set(k, fresh);
        }
      }
    }
    if (isAdminLogin || scope === "admin_panel") {
      if (cleanPhone !== "15509601222") {
        console.warn(`[SMS Server] Security Block: Denied SMS code for unauthorized phone ${cleanPhone} attempting admin login`);
        return res.status(403).json({
          success: false,
          error: "\u274C \u6743\u9650\u62D2\u7EDD\uFF1A\u53EA\u6709\u6700\u9AD8\u5F00\u53D1\u8005\u8D26\u53F7\uFF0815509601222\uFF09\u624D\u6709\u6743\u9650\u83B7\u53D6\u7BA1\u7406\u540E\u53F0\u9A8C\u8BC1\u7801\uFF01"
        });
      }
    }
    if (scope === "dispatch_valet" && !WHITELIST_PHONES.includes(cleanPhone)) {
      const clientIp = getClientIp(req);
      const now = Date.now();
      const LIMIT_24H = 24 * 60 * 60 * 1e3;
      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && now - lastPhoneTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u624B\u673A\u53F7 ${cleanPhone} 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && now - lastIpTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u5F53\u524D IP \u5730\u5740 (${clientIp}) 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
    }
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const signName = process.env.ALIBABA_CLOUD_SIGN_NAME || "\u6052\u521B\u8054\u4F17";
    const templateCode = process.env.ALIBABA_CLOUD_TEMPLATE_CODE || "100001";
    if (!accessKeyId || !accessKeySecret) {
      return res.status(400).json({
        success: false,
        error: "\u274C \u672A\u914D\u7F6E\u963F\u91CC\u4E91 AccessKey\uFF08ALIBABA_CLOUD_ACCESS_KEY_ID / SECRET\uFF09\uFF0C\u8BF7\u5728\u5B9D\u5854\u9762\u677F\u73AF\u5883\u53D8\u91CF\u6216\u914D\u7F6E\u6587\u4EF6\u4E2D\u8BBE\u7F6E\u3002"
      });
    }
    try {
      console.log(`[Alibaba Cloud SMS] Requesting SMS for phone: ${phone}, signName: ${signName}, template: ${templateCode}`);
      const generatedCode = String(Math.floor(1e3 + Math.random() * 9e3));
      let isSuccess = false;
      let lastErrMsg = "";
      if (templateCode.startsWith("SMS_")) {
        try {
          const Core = await import("@alicloud/pop-core");
          const PopClient = Core.default || Core;
          const popClient = new PopClient({
            accessKeyId,
            accessKeySecret,
            endpoint: "https://dysmsapi.aliyuncs.com",
            apiVersion: "2017-05-25"
          });
          const params = {
            PhoneNumbers: String(phone),
            SignName: signName,
            TemplateCode: templateCode,
            TemplateParam: JSON.stringify({ code: generatedCode })
          };
          const popRes = await popClient.request("SendSms", params, { method: "POST", formatType: "json" });
          console.log("[Alibaba Cloud Dysmsapi] Response:", JSON.stringify(popRes));
          if (popRes && (popRes.Code === "OK" || popRes.code === "OK")) {
            isSuccess = true;
          } else {
            lastErrMsg = popRes?.Message || popRes?.message || popRes?.Code || "\u963F\u91CC\u4E91\u77ED\u4FE1\u53D1\u9001\u5931\u8D25";
          }
        } catch (dysmsErr) {
          console.warn("[Alibaba Cloud Dysmsapi] Error:", dysmsErr.message);
          lastErrMsg = dysmsErr.message;
        }
      }
      if (!isSuccess) {
        try {
          const client = getDypnsClient();
          if (client) {
            const sendRequestClass = $Dypnsapi20170525.SendSmsVerifyCodeRequest || $Dypnsapi20170525.default?.SendSmsVerifyCodeRequest || $Dypnsapi20170525.default?.SendSmsVerifyCodeRequest;
            const requestParams = {
              phoneNumber: String(phone),
              signName,
              templateCode,
              templateParam: JSON.stringify({ code: "##code##", min: "5" }),
              schemeName: "\u9ED8\u8BA4\u65B9\u6848",
              codeLength: 4,
              validTime: 300,
              duplicatePolicy: 2,
              interval: 30,
              codeType: 1,
              returnVerifyCode: true
            };
            const sendRequest = sendRequestClass ? new sendRequestClass(requestParams) : requestParams;
            const response = await client.sendSmsVerifyCode(sendRequest);
            const respCode = response?.body?.code || "";
            const respMsg = response?.body?.message || "";
            if (response && response.body && (respCode === "OK" || response.body.success === true)) {
              console.log("[Alibaba Cloud Dypnsapi] Send verify code success for:", phone);
              const returnedCode = response.body.model?.verifyCode || generatedCode;
              verificationCodes.set(phone, { code: returnedCode, expiresAt: Date.now() + 5 * 60 * 1e3 });
              return res.json({
                success: true,
                mode: "real",
                message: "\u2713 \u77ED\u4FE1\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001\uFF0C\u8BF7\u6CE8\u610F\u67E5\u6536\u3002"
              });
            } else if (respCode === "biz.FREQUENCY" || respCode === "isv.BUSINESS_LIMIT_CONTROL" || respMsg.toLowerCase().includes("frequency") || respMsg.includes("BUSINESS_LIMIT_CONTROL")) {
              console.log("[Alibaba Cloud Dypnsapi] Frequency control reached for:", phone, "- Activated high-availability verification fallback");
              const existing = verificationCodes.get(phone);
              if (existing && Date.now() < existing.expiresAt) {
                return res.json({
                  success: true,
                  mode: "real_frequency_fallback",
                  message: "\u26A0\uFE0F \u89E6\u53D1\u963F\u91CC\u4E91\u53D1\u9001\u9891\u7387\u63A7\u5236\uFF1A\u60A8\u4E4B\u524D\u83B7\u53D6\u7684\u77ED\u4FE1\u9A8C\u8BC1\u7801\u4F9D\u7136\u6709\u6548\uFF0C\u8BF7\u67E5\u770B\u624B\u673A\u5DF2\u6536\u5230\u7684\u6700\u65B0\u9A8C\u8BC1\u7801\u76F4\u63A5\u8F93\u5165\u767B\u5F55\uFF01"
                });
              }
              return res.status(429).json({
                success: false,
                error: "\u26A0\uFE0F \u77ED\u4FE1\u53D1\u9001\u9891\u7387\u8FC7\u9AD8\uFF0C\u8BF7\u7B49\u5F85 60 \u79D2\u540E\u518D\u8BD5"
              });
            } else {
              console.log("[Alibaba Cloud Dypnsapi] Non-OK response code:", respCode);
              lastErrMsg = respMsg || `\u963F\u91CC\u4E91\u8FD4\u56DE\u72B6\u6001\u7801: ${respCode || "UNKNOWN"}`;
            }
          }
        } catch (dypnsErr) {
          console.warn("[Alibaba Cloud Dypnsapi] Error:", dypnsErr.message);
          lastErrMsg = dypnsErr.message || lastErrMsg;
          if (lastErrMsg.toLowerCase().includes("frequency") || lastErrMsg.includes("check frequency failed") || lastErrMsg.includes("BUSINESS_LIMIT_CONTROL")) {
            return res.status(429).json({
              success: false,
              error: "\u26A0\uFE0F \u77ED\u4FE1\u53D1\u9001\u9891\u7387\u8FC7\u9AD8\uFF0C\u8BF7\u7B49\u5F85 60 \u79D2\u540E\u518D\u8BD5"
            });
          }
        }
      }
      if (isSuccess) {
        verificationCodes.set(phone, { code: generatedCode, expiresAt: Date.now() + 5 * 60 * 1e3 });
        return res.json({
          success: true,
          mode: "real",
          message: "\u2713 \u77ED\u4FE1\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001\uFF0C\u8BF7\u6CE8\u610F\u67E5\u6536\u3002"
        });
      }
      return res.status(400).json({
        success: false,
        error: `\u274C \u963F\u91CC\u4E91\u77ED\u4FE1\u53D1\u9001\u5931\u8D25: ${lastErrMsg || "\u8BF7\u6838\u5BF9\u963F\u91CC\u4E91 AccessKey\u3001\u7B7E\u540D\u4E0E\u6A21\u677F\u914D\u7F6E"}`
      });
    } catch (error) {
      console.error("[SMS Service] Alibaba Cloud SMS Exception:", error);
      return res.status(500).json({
        success: false,
        error: `\u274C \u963F\u91CC\u4E91\u77ED\u4FE1\u63A5\u53E3\u5F02\u5E38: ${error.message || "\u7F51\u7EDC\u8FDE\u63A5\u8D85\u65F6"}`
      });
    }
  });
  app.post("/api/auth/logout", async (req, res) => {
    try {
      return res.json({ success: true });
    } catch (e) {
      return res.json({ success: true });
    }
  });
  app.post("/api/admin/revoke-token", requireDbAuth, async (req, res) => {
    try {
      if (!req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u4EC5\u5F00\u53D1\u8005\u53EF\u540A\u9500 token" });
      }
      const rawTarget = String(req.body?.phone || "").trim().toUpperCase();
      const digits = rawTarget.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(digits)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      if (digits === DEVELOPER_PHONE_SERVER) {
        return res.status(403).json({ success: false, error: "\u4E0D\u80FD\u540A\u9500\u5F00\u53D1\u8005\u672C\u4EBA\u7684 token" });
      }
      const targetPhone = rawTarget.endsWith("A") ? digits + "A" : digits;
      let revokedToken = "";
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["auth_tokens", `p:${targetPhone}`]
          );
          if (rows && rows.length > 0) {
            const d = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
            revokedToken = String(d?.token || "");
          }
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["auth_tokens", `p:${targetPhone}`]
          );
          if (revokedToken) {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
              ["auth_tokens", `t:${revokedToken}`]
            );
          } else {
            const [tRows] = await mysqlPool.query(
              "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` LIKE ?",
              ["auth_tokens", "t:%"]
            );
            for (const row of tRows || []) {
              try {
                const td = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
                if (td && String(td.phone || "") === targetPhone) {
                  revokedToken = String(row.doc_id).slice(2);
                  await mysqlPool.query(
                    "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                    ["auth_tokens", row.doc_id]
                  );
                  break;
                }
              } catch (_) {
              }
            }
          }
        } catch (e) {
          return res.status(500).json({ success: false, error: "\u540A\u9500\u5931\u8D25\uFF1A" + (e?.message || e) });
        }
      }
      try {
        const dbData = readLocalJsonDb() || {};
        if (dbData.auth_tokens) {
          const pDoc = dbData.auth_tokens[`p:${targetPhone}`];
          if (pDoc && pDoc.token) revokedToken = String(pDoc.token);
          delete dbData.auth_tokens[`p:${targetPhone}`];
          if (revokedToken) {
            delete dbData.auth_tokens[`t:${revokedToken}`];
          } else {
            for (const k of Object.keys(dbData.auth_tokens)) {
              if (k.startsWith("t:") && String(dbData.auth_tokens[k]?.phone || "") === targetPhone) {
                revokedToken = k.slice(2);
                delete dbData.auth_tokens[k];
                break;
              }
            }
          }
          writeLocalJsonDb(dbData);
        }
      } catch (_) {
      }
      if (revokedToken && authTokens.has(revokedToken)) {
        authTokens.delete(revokedToken);
        persistAuthTokensSync();
      }
      invalidatePersistentTokenCacheByPhone(targetPhone);
      await logAdminOperation("revoke-token", String(req.authPhone || ""), targetPhone, `\u540A\u9500 ${targetPhone} \u7684\u767B\u5F55token\uFF08\u7EC8\u8EAB\u5236\u6B62\u635F\uFF09`, req);
      return res.json({ success: true, revoked: !!revokedToken, phone: targetPhone });
    } catch (e) {
      return res.status(500).json({ success: false, error: e?.message || "Revoke Error" });
    }
  });
  app.post("/api/sms/verify", async (req, res) => {
    const { phone, code, isAdminLogin, scope } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u6216\u9A8C\u8BC1\u7801\u4E0D\u80FD\u4E3A\u7A7A" });
    }
    const cleanPhone = String(phone).trim();
    const SMS_UNLIMITED_PHONES_VERIFY = /* @__PURE__ */ new Set(["15509601222", "15121904440", "18695119126"]);
    const isSmsUnlimitedVerify = SMS_UNLIMITED_PHONES_VERIFY.has(cleanPhone);
    const REVIEW_TEST_PHONE = "15121904440";
    const REVIEW_TEST_CODE = "7319";
    const isReviewTestLogin = cleanPhone === REVIEW_TEST_PHONE && String(code).trim() === REVIEW_TEST_CODE && !isAdminLogin && scope !== "admin_panel" && scope !== "dispatch_valet";
    if (!isSmsUnlimitedVerify) {
      const failInfo = verifyFailures.get(cleanPhone);
      if (failInfo && Date.now() < failInfo.lockedUntil) {
        const remainMin = Math.ceil((failInfo.lockedUntil - Date.now()) / 6e4);
        return res.status(429).json({
          success: false,
          error: `\u274C \u9A8C\u8BC1\u7801\u9519\u8BEF\u6B21\u6570\u8FC7\u591A\uFF0C\u8BE5\u624B\u673A\u53F7\u5DF2\u9501\u5B9A\uFF0C\u8BF7 ${remainMin} \u5206\u949F\u540E\u518D\u8BD5`
        });
      }
    }
    {
      const vIp = getClientIp(req);
      const vKey = `ip:${vIp}`;
      const vNow = Date.now();
      const vLogs = (smsVerifyIpLogs.get(vKey) || []).filter((t) => vNow - t < 10 * 60 * 1e3);
      if (vLogs.length >= 30) {
        return res.status(429).json({ success: false, error: "\u274C \u6821\u9A8C\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" });
      }
      vLogs.push(vNow);
      smsVerifyIpLogs.set(vKey, vLogs);
      if (smsVerifyIpLogs.size > 5e3) {
        for (const [k2, v2] of smsVerifyIpLogs) {
          const fresh = v2.filter((t) => vNow - t < 10 * 60 * 1e3);
          if (fresh.length === 0) smsVerifyIpLogs.delete(k2);
          else smsVerifyIpLogs.set(k2, fresh);
        }
      }
    }
    const recordVerifyFailure = () => {
      if (isSmsUnlimitedVerify) return;
      const info = verifyFailures.get(cleanPhone) || { count: 0, lockedUntil: 0 };
      info.count += 1;
      if (info.count >= 5) {
        info.lockedUntil = Date.now() + 30 * 60 * 1e3;
        info.count = 0;
        verificationCodes.delete(cleanPhone);
        verificationCodes.delete(phone);
        console.warn(`[SMS] \u624B\u673A\u53F7 ${cleanPhone} \u9A8C\u8BC1\u7801\u9519\u8BEF5\u6B21\uFF0C\u9A8C\u8BC1\u7801\u5DF2\u9500\u6BC1\u5E76\u9501\u5B9A30\u5206\u949F`);
      }
      verifyFailures.set(cleanPhone, info);
    };
    const clearVerifyFailures = () => {
      verifyFailures.delete(cleanPhone);
    };
    if (isAdminLogin || scope === "admin_panel") {
      if (cleanPhone !== "15509601222") {
        console.warn(`[SMS Server] Security Block: Denied login verification for unauthorized phone ${cleanPhone}`);
        return res.status(403).json({
          success: false,
          error: "\u274C \u767B\u5F55\u62D2\u7EDD\uFF1A\u975E\u6700\u9AD8\u5F00\u53D1\u8005\u8D26\u53F7\uFF0815509601222\uFF09\uFF0C\u65E0\u6CD5\u767B\u5F55\u7BA1\u7406\u540E\u53F0\uFF01"
        });
      }
    }
    const clientIp = getClientIp(req);
    const now = Date.now();
    const LIMIT_24H = 24 * 60 * 60 * 1e3;
    if (scope === "dispatch_valet" && !WHITELIST_PHONES.includes(cleanPhone)) {
      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && now - lastPhoneTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u624B\u673A\u53F7 ${cleanPhone} 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && now - lastIpTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u5F53\u524D IP \u5730\u5740 (${clientIp}) 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
    }
    const record = verificationCodes.get(phone);
    if (!record && !isReviewTestLogin) {
      return res.status(400).json({ success: false, error: "\u8BF7\u5148\u83B7\u53D6\u9A8C\u8BC1\u7801" });
    }
    if (record && Date.now() > record.expiresAt && !isReviewTestLogin) {
      verificationCodes.delete(phone);
      return res.status(400).json({ success: false, error: "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u83B7\u53D6" });
    }
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const isSimulated = !accessKeyId || !accessKeySecret;
    const handleLoginSuccess = async () => {
      verificationCodes.delete(phone);
      clearVerifyFailures();
      if (scope === "dispatch_valet" && !WHITELIST_PHONES.includes(cleanPhone)) {
        dispatchPhoneLoginLogs.set(cleanPhone, now);
        dispatchIpLoginLogs.set(clientIp, now);
      }
      try {
        const dbData = readLocalJsonDb();
        if (!dbData.driver_users) dbData.driver_users = {};
        const existing = dbData.driver_users[cleanPhone];
        const defaultQrUrl = `/uploads/qrcodes/${cleanPhone}.png`;
        let mysqlExisting = null;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [mrows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["driver_users", cleanPhone]
            );
            if (mrows && mrows.length > 0) {
              mysqlExisting = typeof mrows[0].data === "string" ? JSON.parse(mrows[0].data) : mrows[0].data;
            }
          } catch (_) {
          }
        }
        if (!existing && !mysqlExisting) {
          const newDriverProfile = {
            id: cleanPhone,
            phone: cleanPhone,
            phoneNumber: cleanPhone,
            driverName: cleanPhone === "15509601222" ? "\u5434\u5F66\u7956" : `\u53F8\u673A${cleanPhone.slice(-4)}`,
            name: cleanPhone === "15509601222" ? "\u5434\u5F66\u7956" : `\u53F8\u673A${cleanPhone.slice(-4)}`,
            role: cleanPhone === "15509601222" ? "\u5F00\u53D1\u8005\u53F8\u673A" : "\u666E\u901A\u53F8\u673A",
            userRole: cleanPhone === "15509601222" ? "\u5F00\u53D1\u8005\u53F8\u673A" : "\u666E\u901A\u53F8\u673A",
            position: cleanPhone === "15509601222" ? "\u5F00\u53D1\u8005\u53F8\u673A" : "\u666E\u901A\u53F8\u673A",
            squad_position: cleanPhone === "15509601222" ? "developer" : "normal",
            is_squad_member: cleanPhone === "15509601222" ? 1 : 0,
            status: cleanPhone === "15509601222" ? "\u5DF2\u901A\u8FC7" : "\u672A\u52A0\u5165\u5C0F\u961F",
            vipExpiry: existing?.vipExpiry || "\u5F85\u5F00\u901A",
            city: "\u94F6\u5DDD\u5E02",
            isOnline: false,
            onlineOrdersEnabled: false,
            isBanned: false,
            today_orders_count: 0,
            qrcode_url: "",
            wechatQrCode: "",
            qrCode: "",
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          dbData.driver_users[cleanPhone] = newDriverProfile;
          writeLocalJsonDb(dbData);
          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["driver_users", cleanPhone, JSON.stringify(newDriverProfile)]
            ).catch(() => {
            });
          }
        } else if (mysqlExisting && !existing) {
          dbData.driver_users[cleanPhone] = mysqlExisting;
          writeLocalJsonDb(dbData);
        } else if (existing && !mysqlExisting && isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            "INSERT IGNORE INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?)",
            ["driver_users", cleanPhone, JSON.stringify(existing)]
          ).catch(() => {
          });
        }
      } catch (regErr) {
        console.error("[Auto Register Driver User Error]:", regErr);
      }
      const tokenScope = scope || (isAdminLogin ? "admin_panel" : "driver");
      const isMerchantLogin = String(scope || "").trim() === "dispatch_valet";
      const tokenPhone = isMerchantLogin ? String(cleanPhone || "").trim().toUpperCase() + "A" : cleanPhone;
      const authToken = await getOrCreatePersistentToken(tokenPhone, tokenScope, isMerchantLogin);
      try {
        const dbData = readLocalJsonDb();
        const rp = dbData?._config?.removedPhones;
        const phoneNorm = String(cleanPhone || "").replace(/\D/g, "").trim();
        if (Array.isArray(rp) && phoneNorm && rp.includes(phoneNorm)) {
          dbData._config.removedPhones = rp.filter((p) => p !== phoneNorm);
          writeLocalJsonDb(dbData);
        }
      } catch (_) {
      }
      authTokens.set(authToken, {
        phone: tokenPhone,
        scope: tokenScope,
        isMerchant: isMerchantLogin,
        createdAt: Date.now()
      });
      _authTokensDirty = true;
      persistAuthTokensSync();
      if (authTokens.size > 5e4) {
        console.warn("[Auth] token \u6570\u91CF\u8D85\u8FC75\u4E07\uFF0C\u4EC5\u8BB0\u5F55\u544A\u8B66\uFF0C\u4E0D\u81EA\u52A8\u6E05\u7406");
      }
      return res.json({ success: true, message: "\u9A8C\u8BC1\u7801\u6821\u9A8C\u6210\u529F", token: authToken });
    };
    if (isReviewTestLogin) {
      console.log(`[SMS] \u534E\u4E3A\u63D0\u5BA1\u6D4B\u8BD5\u53F7\u56FA\u5B9A\u7801\u767B\u5F55\u6210\u529F: ${cleanPhone}`);
      return handleLoginSuccess();
    }
    if (isSimulated || record.code && record.code !== "ALIYUN_EXTERNAL" && record.code === String(code).trim()) {
      if (record.code !== "ALIYUN_EXTERNAL" && record.code !== String(code).trim()) {
        recordVerifyFailure();
        return res.status(400).json({ success: false, error: "\u9A8C\u8BC1\u7801\u9519\u8BEF\uFF0C\u8BF7\u8F93\u5165\u6B63\u786E\u7684\u9A8C\u8BC1\u7801" });
      }
      return handleLoginSuccess();
    }
    try {
      console.log(`[Alibaba Cloud SMS] Requesting CheckSmsVerifyCode for: ${phone} with code: ${code}`);
      const client = getDypnsClient();
      if (!client) {
        throw new Error("Alibaba Cloud client initialization failed");
      }
      const checkRequestClass = $Dypnsapi20170525.CheckSmsVerifyCodeRequest || $Dypnsapi20170525.default?.CheckSmsVerifyCodeRequest || $Dypnsapi20170525.default?.CheckSmsVerifyCodeRequest;
      const requestParams = {
        phoneNumber: String(phone),
        verifyCode: String(code).trim(),
        schemeName: "\u9ED8\u8BA4\u65B9\u6848"
      };
      const checkRequest = checkRequestClass ? new checkRequestClass(requestParams) : requestParams;
      const response = await client.checkSmsVerifyCode(checkRequest);
      const responseCode = response?.body?.code || "";
      const responseMsg = response?.body?.message || "";
      if (responseCode === "OK" || response?.body?.success === true) {
        console.log("[Alibaba Cloud SMS] Check response success for:", phone);
      } else {
        console.log("[Alibaba Cloud SMS] Check response code:", responseCode, responseMsg ? `message: ${responseMsg}` : "");
      }
      const resultVal = response?.body?.model?.verifyResult;
      const isMatchVal = response?.body?.model?.isMatch;
      const isSuccess = resultVal === true || resultVal === 1 || String(resultVal) === "1" || String(resultVal).toUpperCase() === "PASS" || String(resultVal).toUpperCase() === "SUCCESS" || String(resultVal) === "true" || isMatchVal === true || isMatchVal === 1 || String(isMatchVal) === "1";
      if (isSuccess) {
        return handleLoginSuccess();
      } else {
        const resCode = response?.body?.code || "";
        const resMsg = response?.body?.message || "";
        if (resCode === "biz.FREQUENCY" || resCode === "isv.BUSINESS_LIMIT_CONTROL" || resMsg.toLowerCase().includes("frequency") || resMsg.includes("check frequency failed")) {
          if (record && record.code && record.code !== "ALIYUN_EXTERNAL" && record.code === String(code).trim()) {
            return handleLoginSuccess();
          }
          return res.status(429).json({
            success: false,
            error: "\u26A0\uFE0F \u9A8C\u8BC1\u7801\u6821\u9A8C\u9891\u7387\u8FC7\u9AD8\uFF1A\u89E6\u53D1\u963F\u91CC\u4E91\u5B89\u5168\u9891\u7387\u9650\u5236\uFF0C\u8BF7\u7B49\u5F85 60 \u79D2\u540E\u91CD\u8BD5\uFF01"
          });
        }
        recordVerifyFailure();
        return res.status(400).json({
          success: false,
          error: resMsg ? `\u9A8C\u8BC1\u7801\u6821\u9A8C\u5931\u8D25: ${resMsg}` : "\u9A8C\u8BC1\u7801\u8F93\u5165\u9519\u8BEF\u6216\u6838\u9A8C\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u6216\u83B7\u53D6"
        });
      }
    } catch (error) {
      console.log(`[SMS Service] High-availability verification check for: ${phone}`);
      return res.status(503).json({
        success: false,
        error: `\u9A8C\u8BC1\u7801\u6821\u9A8C\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528: ${error.message || "\u7CFB\u7EDF\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"}`
      });
    }
  });
  app.get("/api/db/migrate-from-firestore", requireDbAuth, async (req, res) => {
    return res.status(410).json({ success: false, error: "\u8BE5\u8FC1\u79FB\u63A5\u53E3\u5DF2\u4E0B\u7EBF" });
  });
  app.post("/api/submit", async (req, res) => {
    return res.status(410).json({ success: false, error: "\u8BE5\u63A5\u53E3\u5DF2\u4E0B\u7EBF" });
  });
  app.get("/api/passenger/link-info", async (req, res) => {
    try {
      const driver = String(req.query.driver || req.query.phone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(driver)) {
        return res.status(400).json({ success: false, error: "\u53F8\u673A\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const liIp = getClientIp(req);
      const liNow = Date.now();
      if (!global.__linkInfoLogs) global.__linkInfoLogs = /* @__PURE__ */ new Map();
      const liLogs = global.__linkInfoLogs;
      const liArr = (liLogs.get(liIp) || []).filter((t) => liNow - t < 6e4);
      if (liArr.length >= 60) {
        return res.status(429).json({ success: false, error: "\u64CD\u4F5C\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" });
      }
      liArr.push(liNow);
      liLogs.set(liIp, liArr);
      const doc = await readStatusDocument("driver_users", driver) || await readStatusDocument("squad_members", driver);
      if (!doc) {
        return res.json({ success: true, exists: false });
      }
      const { vipExpiry } = await readDriverExpiryUnified(driver);
      const brandName = String(doc.customAppName || doc.driverBrandName || "").trim();
      const effectiveVipExpiry = vipExpiry || doc.vipExpiry || "\u5F85\u5F00\u901A";
      return res.json({ success: true, exists: true, vipExpiry: effectiveVipExpiry, vipActive: isVipActiveServer(effectiveVipExpiry), brandName });
    } catch (err) {
      return res.status(500).json({ success: false, error: "\u67E5\u8BE2\u5931\u8D25" });
    }
  });
  app.post("/api/qr-phone-notify", async (req, res) => {
    try {
      const qpDriverPhone = String(req.body?.driverPhone || "").replace(/\D/g, "").trim();
      const targetPhone = qpDriverPhone;
      if (!/^1[3-9]\d{9}$/.test(targetPhone)) {
        return res.status(400).json({ success: false, error: "\u53F8\u673A\u624B\u673A\u53F7\u683C\u5F0F\u4E0D\u6B63\u786E" });
      }
      try {
        const vipExpiry = (await readDriverExpiryUnified(targetPhone)).vipExpiry;
        if (!isVipActiveServer(vipExpiry)) {
          return res.status(403).json({ success: false, error: "\u4E8C\u7EF4\u7801\u521B\u5355\u4E3AVIP\u4E13\u5C5E\u529F\u80FD\uFF0C\u8BF7\u5148\u5F00\u901AVIP" });
        }
      } catch (e) {
        console.error("[QRNotify] VIP\u6821\u9A8C\u5F02\u5E38:", e?.message);
        return res.status(503).json({ success: false, error: "\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      const { driverPhone, passengerPhone, startLocation } = req.body || {};
      if (!driverPhone || !passengerPhone) {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570" });
      }
      const cleanDriverPhone = String(driverPhone).replace(/\D/g, "").trim();
      const cleanPassengerPhone = String(passengerPhone).replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(cleanDriverPhone) || !/^1[3-9]\d{9}$/.test(cleanPassengerPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const qrT = Number(req.body?.t || 0);
      if (qrT > 0) {
        const nowTs = Date.now();
        if (nowTs - qrT > 24e4 || qrT - nowTs > 6e4) {
          return res.status(410).json({ success: false, error: "\u4E8C\u7EF4\u7801\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u8054\u7CFB\u53F8\u673A\u91CD\u65B0\u51FA\u793A\u4E8C\u7EF4\u7801" });
        }
      }
      const clientIp = getClientIp(req);
      const now = Date.now();
      if (!global.__qrPhoneLogs) global.__qrPhoneLogs = /* @__PURE__ */ new Map();
      const qrPhoneLogs = global.__qrPhoneLogs;
      const logs = (qrPhoneLogs.get(clientIp) || []).filter((t) => now - t < 6e4);
      if (logs.length >= 3) {
        return res.status(429).json({ success: false, error: "\u64CD\u4F5C\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" });
      }
      logs.push(now);
      qrPhoneLogs.set(clientIp, logs);
      const refStartLocation = String(startLocation || "").trim().slice(0, 100);
      const payloadData = {
        type: "qr_phone_notify",
        // 区别于完整订单，司机端据此走轻量通知流程
        driverPhone: cleanDriverPhone,
        passengerPhone: cleanPassengerPhone,
        startLocation: refStartLocation,
        status: "submitted",
        timestamp: Date.now(),
        updatedAt: Date.now()
      };
      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(payloadData);
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["qr_notifications", cleanDriverPhone, dataStr]
        );
        return res.json({ success: true, timestamp: Date.now() });
      }
      const dbData = readLocalJsonDb();
      if (!dbData.qr_notifications) dbData.qr_notifications = {};
      dbData.qr_notifications[cleanDriverPhone] = payloadData;
      writeLocalJsonDb(dbData);
      res.json({ success: true, timestamp: Date.now() });
    } catch (err) {
      console.error("[QR Phone Notify] error:", err);
      res.status(500).json({ success: false, error: err.message || "QR Phone Notify Error" });
    }
  });
  app.get("/api/qr-notify-check", requireDbAuth, async (req, res) => {
    try {
      const authPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      const driverPhone = String(req.query.driverPhone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(driverPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      if (authPhone !== driverPhone && authPhone !== "15509601222") {
        return res.status(403).json({ success: false, error: "\u53EA\u80FD\u67E5\u8BE2\u81EA\u5DF1\u7684\u4E8C\u7EF4\u7801\u901A\u77E5" });
      }
      let payloadData = null;
      let payloadSource = "qr_notifications";
      if (isMySQLEnabled && mysqlPool) {
        for (const colTry of ["qr_notifications", "passenger_links"]) {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            [colTry, driverPhone]
          );
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsed && parsed.type === "qr_phone_notify") {
              payloadData = parsed;
              payloadSource = colTry;
              break;
            }
          }
        }
      } else {
        const dbData = readLocalJsonDb();
        const fromNew = dbData?.qr_notifications?.[driverPhone];
        if (fromNew && fromNew.type === "qr_phone_notify") {
          payloadData = fromNew;
        } else {
          payloadData = dbData?.passenger_links?.[driverPhone] || null;
          payloadSource = "passenger_links";
        }
      }
      if (payloadData && payloadData.type === "qr_phone_notify" && payloadData.status === "submitted" && payloadData.timestamp > Date.now() - 3e5) {
        try {
          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? AND CAST(JSON_EXTRACT(`data`, '$.timestamp') AS UNSIGNED) = ?",
              [payloadSource, driverPhone, Number(payloadData.timestamp || 0)]
            );
          } else {
            const dbData = readLocalJsonDb();
            const cur = dbData?.[payloadSource]?.[driverPhone];
            if (cur && Number(cur.timestamp || 0) === Number(payloadData.timestamp || 0)) {
              delete dbData[payloadSource][driverPhone];
              writeLocalJsonDb(dbData);
            }
          }
        } catch (_) {
        }
        return res.json({ success: true, hasNotify: true, data: payloadData });
      }
      return res.json({ success: true, hasNotify: false });
    } catch (err) {
      console.error("[QR Notify Check] error:", err);
      res.status(500).json({ success: false, error: err.message || "QR Notify Check Error" });
    }
  });
  app.get("/api/vip-code-check", requireDbAuth, async (req, res) => {
    try {
      const code = String(req.query.code || "").trim().toUpperCase();
      if (!code) {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11\u5151\u6362\u7801" });
      }
      let foundData = null;
      if (isMySQLEnabled && mysqlPool) {
        const [rows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          ["vip_codes", code]
        );
        if (rows && rows.length > 0) {
          const raw = rows[0].data;
          foundData = typeof raw === "string" ? JSON.parse(raw) : raw;
        }
      } else {
        const dbData = readLocalJsonDb();
        foundData = dbData?.vip_codes?.[code] || null;
      }
      if (foundData) {
        return res.json({ success: true, exists: true, duration: foundData.duration || 30, isRedeemed: !!foundData.isRedeemed });
      }
      return res.json({ success: true, exists: false });
    } catch (err) {
      console.error("[VIP Code Check] error:", err);
      res.status(500).json({ success: false, error: err.message || "VIP Code Check Error" });
    }
  });
  app.post("/api/vip-code-redeem", requireDbAuth, async (req, res) => {
    try {
      const { code } = req.body || {};
      const cleanCode = String(code || "").trim().toUpperCase();
      const redeemerPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      if (!cleanCode) {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11\u5151\u6362\u7801" });
      }
      if (!/^1[3-9]\d{9}$/.test(redeemerPhone)) {
        return res.status(400).json({ success: false, error: "\u8EAB\u4EFD\u5F02\u5E38" });
      }
      const calcExpiry = (currentExpiry, durationDays2) => {
        if (durationDays2 === 99999) return "\u6C38\u4E45\u6709\u6548";
        let base = /* @__PURE__ */ new Date();
        if (currentExpiry && currentExpiry !== "\u6C38\u4E45\u6709\u6548" && currentExpiry !== "\u5F85\u5F00\u901A") {
          const parsed = Date.parse(currentExpiry);
          if (!isNaN(parsed)) {
            const prev = new Date(parsed);
            if (prev.getTime() > base.getTime()) base = prev;
          }
        }
        base.setDate(base.getDate() + durationDays2);
        const yyyy = base.getFullYear();
        const mm = String(base.getMonth() + 1).padStart(2, "0");
        const dd = String(base.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      };
      let finalExpiry = "";
      let durationDays = 30;
      if (isMySQLEnabled && mysqlPool) {
        const conn = await mysqlPool.getConnection();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? FOR UPDATE",
            ["vip_codes", cleanCode]
          );
          if (!rows || rows.length === 0) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ success: false, error: "\u5151\u6362\u7801\u4E0D\u5B58\u5728" });
          }
          const foundData = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
          if (foundData.isRedeemed) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ success: false, error: "\u8BE5\u5151\u6362\u7801\u5DF2\u88AB\u4F7F\u7528" });
          }
          durationDays = Number(foundData.duration) || 30;
          const purePhone = redeemerPhone.replace(/A$/, "");
          let creditedMysql = false;
          for (const col of ["driver_users", "squad_members", "online_applications"]) {
            for (const p of [redeemerPhone, purePhone]) {
              const [erows] = await conn.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                [col, p]
              );
              if (erows && erows.length > 0) {
                const edata = typeof erows[0].data === "string" ? JSON.parse(erows[0].data) : erows[0].data;
                if (!finalExpiry) finalExpiry = calcExpiry(String(edata.vipExpiry || ""), durationDays);
                edata.vipExpiry = finalExpiry;
                edata.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
                await conn.query(
                  "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                  [col, p, JSON.stringify(edata)]
                );
                creditedMysql = true;
              }
            }
          }
          if (!creditedMysql || !finalExpiry) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ success: false, error: "\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u53F8\u673A\u6863\u6848\uFF0C\u65E0\u6CD5\u5151\u6362" });
          }
          foundData.isRedeemed = true;
          foundData.redeemedAt = (/* @__PURE__ */ new Date()).toISOString();
          foundData.redeemedBy = redeemerPhone;
          await conn.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["vip_codes", cleanCode, JSON.stringify(foundData)]
          );
          await conn.commit();
          conn.release();
          try {
            const jdb = readLocalJsonDb();
            if (!jdb.vip_codes) jdb.vip_codes = {};
            jdb.vip_codes[cleanCode] = foundData;
            const pureP2 = redeemerPhone.replace(/A$/, "");
            for (const col of ["driver_users", "squad_members", "online_applications"]) {
              for (const p of [redeemerPhone, pureP2]) {
                if (jdb[col]?.[p] && finalExpiry) {
                  jdb[col][p].vipExpiry = finalExpiry;
                  jdb[col][p].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
                }
              }
            }
            writeLocalJsonDb(jdb);
          } catch (_) {
          }
        } catch (e) {
          try {
            await conn.rollback();
            conn.release();
          } catch (_) {
          }
          throw e;
        }
      } else {
        const dbData = readLocalJsonDb();
        const foundData = dbData?.vip_codes?.[cleanCode] || null;
        if (!foundData) {
          return res.status(404).json({ success: false, error: "\u5151\u6362\u7801\u4E0D\u5B58\u5728" });
        }
        if (foundData.isRedeemed) {
          return res.status(400).json({ success: false, error: "\u8BE5\u5151\u6362\u7801\u5DF2\u88AB\u4F7F\u7528" });
        }
        durationDays = Number(foundData.duration) || 30;
        const purePhone = redeemerPhone.replace(/A$/, "");
        let creditedJson = false;
        for (const col of ["driver_users", "squad_members", "online_applications"]) {
          for (const p of [redeemerPhone, purePhone]) {
            if (dbData[col]?.[p]) {
              if (!finalExpiry) finalExpiry = calcExpiry(String(dbData[col][p].vipExpiry || ""), durationDays);
              dbData[col][p].vipExpiry = finalExpiry;
              dbData[col][p].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
              creditedJson = true;
            }
          }
        }
        if (!creditedJson || !finalExpiry) {
          return res.status(400).json({ success: false, error: "\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u53F8\u673A\u6863\u6848\uFF0C\u65E0\u6CD5\u5151\u6362" });
        }
        foundData.isRedeemed = true;
        foundData.redeemedAt = (/* @__PURE__ */ new Date()).toISOString();
        foundData.redeemedBy = redeemerPhone;
        if (!dbData.vip_codes) dbData.vip_codes = {};
        dbData.vip_codes[cleanCode] = foundData;
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true, vipExpiry: finalExpiry, durationDays });
    } catch (err) {
      console.error("[VIP Code Redeem] error:", err);
      res.status(500).json({ success: false, error: err.message || "VIP Code Redeem Error" });
    }
  });
  app.post("/api/order/to-hall", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, reason } = req.body || {};
      const cleanOrderId = String(orderId || "").trim();
      const cleanDriverPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11 orderId" });
      }
      let hallValidationFailed = false;
      let hallOrderMissing = false;
      try {
        const isDev = req.isAdmin;
        if (!isDev) {
          let order = null;
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [vrows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                ["merchant_orders", cleanOrderId]
              );
              if (vrows && vrows.length > 0) {
                const vraw = vrows[0].data;
                order = typeof vraw === "string" ? JSON.parse(vraw) : vraw;
              }
            } catch (_) {
              order = null;
            }
          }
          if (!order) {
            const dbData = readLocalJsonDb();
            order = dbData.merchant_orders?.[cleanOrderId] || dbData.valet_orders?.[cleanOrderId];
          }
          if (order) {
            const assigned = String(order.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
            if (assigned && assigned !== cleanDriverPhone) {
              return res.status(403).json({ success: false, error: "\u53EA\u6709\u88AB\u6D3E\u53F8\u673A\u53EF\u4EE5\u5C06\u8BE5\u8BA2\u5355\u8F6C\u5165\u5927\u5385" });
            }
            const claimed = String(order.claimedDriverPhone || "").replace(/\D/g, "").trim();
            if (claimed && claimed !== cleanDriverPhone) {
              return res.status(403).json({ success: false, error: "\u8BE5\u8BA2\u5355\u5DF2\u88AB\u5176\u4ED6\u53F8\u673A\u63A5\u8D70\uFF0C\u4E0D\u80FD\u8F6C\u5165\u5927\u5385" });
            }
            const oStatus = String(order.status || "");
            const oCat = String(order.statusCategory || "");
            if (["completed", "\u5DF2\u5B8C\u6210", "cancelled", "\u5DF2\u53D6\u6D88", "serving", "\u670D\u52A1\u4E2D"].includes(oStatus) || ["\u5DF2\u5B8C\u6210", "\u5DF2\u53D6\u6D88", "\u670D\u52A1\u4E2D"].includes(oCat)) {
              return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u5B8C\u7ED3\uFF0C\u4E0D\u80FD\u8F6C\u5165\u5927\u5385" });
            }
          } else {
            hallOrderMissing = true;
          }
        }
      } catch (_) {
        hallValidationFailed = true;
      }
      if (hallValidationFailed) {
        return res.status(500).json({ success: false, error: "\u8BA2\u5355\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      if (hallOrderMissing) {
        return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      if (req.isAdmin) {
        const devExisting = await Promise.resolve(readCanonicalDocument("merchant_orders", cleanOrderId)) || await Promise.resolve(readCanonicalDocument("valet_orders", cleanOrderId));
        if (!devExisting) {
          return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
        }
      }
      const now = Date.now();
      const applyToOrder = (targetOrder) => {
        const existingDeclined = Array.isArray(targetOrder?.declinedDriverPhones) ? targetOrder.declinedDriverPhones : [];
        const existingTimeout = Array.isArray(targetOrder?.timeoutDriverPhones) ? targetOrder.timeoutDriverPhones : [];
        return {
          ...targetOrder || {},
          status: "hall",
          in_hall: true,
          statusCategory: "\u547C\u53EB\u4E2D",
          dispatchedDriverPhone: "",
          dispatchedDriverName: "",
          claimedDriverPhone: "",
          claimedDriverName: "",
          driverName: "",
          declinedDriverPhones: Array.from(new Set([...existingDeclined, cleanDriverPhone].filter(Boolean))),
          timeoutDriverPhones: existingTimeout,
          // 2026-10-20 重构(P2)：拒单/转大厅只记 declined 名单，timeout 名单只由服务端扫单写入
          lastDeclinedAt: now,
          hallReason: String(reason || "timeout_or_decline").slice(0, 50),
          hallAt: Date.now()
        };
      };
      if (isMySQLEnabled && mysqlPool) {
        const [rows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          ["merchant_orders", cleanOrderId]
        );
        let targetOrder = {};
        if (rows && rows.length > 0) {
          const raw = rows[0].data;
          targetOrder = typeof raw === "string" ? JSON.parse(raw) : raw;
        }
        const updated = applyToOrder(targetOrder);
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["merchant_orders", cleanOrderId, JSON.stringify(updated)]
        );
        if (cleanDriverPhone) {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["passenger_links", cleanDriverPhone]
          ).catch(() => {
          });
        }
        try {
          const jdb2 = readLocalJsonDb();
          if (!jdb2["merchant_orders"]) jdb2["merchant_orders"] = {};
          const jm = jdb2["merchant_orders"][cleanOrderId] || {};
          jdb2["merchant_orders"][cleanOrderId] = applyToOrder(jm);
          if (cleanDriverPhone && jdb2["passenger_links"]?.[cleanDriverPhone]) {
            delete jdb2["passenger_links"][cleanDriverPhone];
          }
          writeLocalJsonDb(jdb2);
        } catch (_) {
        }
      } else {
        const dbData = readLocalJsonDb();
        if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
        const targetOrder = dbData["merchant_orders"][cleanOrderId] || {};
        dbData["merchant_orders"][cleanOrderId] = applyToOrder(targetOrder);
        if (cleanDriverPhone && dbData["passenger_links"] && dbData["passenger_links"][cleanDriverPhone]) {
          delete dbData["passenger_links"][cleanDriverPhone];
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Order To Hall] error:", err);
      res.status(500).json({ success: false, error: err.message || "Order To Hall Error" });
    }
  });
  app.post("/api/order/progress", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, stage } = req.body || {};
      const cleanOrderId = String(orderId || "").trim();
      if (!cleanOrderId || stage !== "arrived" && stage !== "serving") {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      const requester = String(req.authPhone || "").replace(/\D/g, "").trim();
      const found = {};
      for (const col of ["merchant_orders", "valet_orders"]) {
        const doc = await Promise.resolve(readCanonicalDocument(col, cleanOrderId));
        if (doc) found[col] = doc;
      }
      const foundCols = Object.keys(found);
      if (foundCols.length === 0) {
        return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      const order = found[foundCols[0]];
      const assigned = String(order.claimedDriverPhone || order.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
      if (!req.isAdmin && assigned !== requester) {
        return res.status(403).json({ success: false, error: "\u53EA\u6709\u63A5\u5355\u53F8\u673A\u53EF\u4EE5\u63A8\u8FDB\u8BE5\u8BA2\u5355\u72B6\u6001" });
      }
      const oStatus = String(order.status || "");
      const oCat = String(order.statusCategory || "");
      if (["completed", "\u5DF2\u5B8C\u6210", "cancelled", "\u5DF2\u53D6\u6D88"].includes(oStatus) || ["\u5DF2\u5B8C\u6210", "\u5DF2\u53D6\u6D88"].includes(oCat)) {
        return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u5B8C\u7ED3\uFF0C\u4E0D\u80FD\u63A8\u8FDB\u72B6\u6001" });
      }
      {
        const claimedBy = String(order.claimedDriverPhone || "").replace(/\D/g, "").trim();
        const progressable = ["claimed", "\u5DF2\u63A5\u5355", "arrived", "\u53F8\u673A\u5230\u8FBE", "serving", "\u670D\u52A1\u4E2D"];
        if (!claimedBy || !progressable.includes(oStatus)) {
          return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5C1A\u672A\u63A5\u5355\uFF0C\u65E0\u6CD5\u63A8\u8FDB\u72B6\u6001" });
        }
      }
      const now = Date.now();
      const patch = stage === "arrived" ? { status: "arrived", statusCategory: "\u53F8\u673A\u5230\u8FBE", arrivedAt: now, updatedAt: now } : { status: "serving", statusCategory: "\u670D\u52A1\u4E2D", servingAt: now, updatedAt: now };
      for (const col of foundCols) {
        const updated = { ...found[col], ...patch };
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            [col, cleanOrderId, JSON.stringify(updated)]
          );
        }
        try {
          const dbData = readLocalJsonDb();
          if (dbData[col]?.[cleanOrderId]) {
            dbData[col][cleanOrderId] = updated;
            writeLocalJsonDb(dbData);
          }
        } catch (_) {
        }
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Order Progress] error:", err);
      res.status(500).json({ success: false, error: err.message || "Order Progress Error" });
    }
  });
  app.post("/api/order/true-cancel", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, driverPhone, reason } = req.body || {};
      const cleanOrderId = String(orderId || "").trim();
      const cleanDriverPhone = String(driverPhone || "").replace(/\D/g, "").trim();
      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11 orderId" });
      }
      const now = Date.now();
      const tcRequester = String(req.authPhone || "").replace(/\D/g, "").trim();
      const tcExisting = {};
      for (const col of ["merchant_orders", "valet_orders"]) {
        const doc = await Promise.resolve(readCanonicalDocument(col, cleanOrderId));
        if (doc) tcExisting[col] = doc;
      }
      const tcCols = Object.keys(tcExisting);
      if (tcCols.length === 0) {
        return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
      }
      const tcOrder = tcExisting[tcCols[0]];
      const tcDriverPhone = String(tcOrder.claimedDriverPhone || tcOrder.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
      const tcCreators = [tcOrder.reporterPhone, tcOrder.merchantPhone, tcOrder.orderPhone].map((v) => String(v || "").replace(/\D/g, "").trim()).filter(Boolean);
      let tcRole = "";
      if (req.isAdmin) tcRole = "admin";
      else if (tcDriverPhone && tcRequester === tcDriverPhone) tcRole = "driver";
      else if (tcCreators.includes(tcRequester)) tcRole = "merchant";
      else {
        let tcMember = null;
        try {
          tcMember = await Promise.resolve(getUnifiedMembership(tcRequester));
        } catch (_) {
        }
        if (tcMember && tcMember.isMember && ["\u57CE\u5E02\u8001\u677F", "\u57CE\u5E02\u7BA1\u7406", "\u57CE\u5E02\u6D3E\u5355\u5458", "\u5F00\u53D1\u8005"].some((r) => String(tcMember.role || "").includes(r))) tcRole = "admin";
      }
      if (!tcRole) {
        return res.status(403).json({ success: false, error: "\u53EA\u6709\u63A5\u5355\u53F8\u673A\u3001\u4E0B\u5355\u65B9\u6216\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u53D6\u6D88\u8BE5\u8BA2\u5355" });
      }
      if (["completed", "\u5DF2\u5B8C\u6210", "finished"].includes(String(tcOrder.status || "")) || String(tcOrder.statusCategory || "") === "\u5DF2\u5B8C\u6210") {
        return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u5B8C\u6210\uFF0C\u65E0\u6CD5\u53D6\u6D88" });
      }
      const cancelPayload = {
        status: "cancelled",
        statusCategory: "\u5DF2\u53D6\u6D88",
        in_hall: false,
        isCancelled: true,
        cancelledAt: now,
        cancelledBy: tcRole,
        cancelledByRole: tcRole,
        cancelledByPhone: tcRequester,
        cancelledDriverPhone: tcDriverPhone,
        cancelReason: String(reason || "\u53F8\u673A\u5DF2\u53D6\u6D88\u8BA2\u5355").slice(0, 100)
      };
      const applyCancel = (targetOrder) => ({ ...targetOrder || {}, ...cancelPayload });
      if (isMySQLEnabled && mysqlPool) {
        for (const col of tcCols) {
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            [col, cleanOrderId, JSON.stringify(applyCancel(tcExisting[col]))]
          ).catch((e) => console.error("[TrueCancel] \u8BA2\u5355\u5199\u5165\u5931\u8D25:", col, cleanOrderId, e?.message));
        }
        if (tcDriverPhone) {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["passenger_links", tcDriverPhone]
          ).catch((e) => console.error("[TrueCancel] \u5220\u9664\u4E58\u5BA2\u94FE\u63A5\u5931\u8D25:", tcDriverPhone, e?.message));
          try {
            const [arows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["active_orders", tcDriverPhone]
            );
            const aDoc = arows && arows.length > 0 ? typeof arows[0].data === "string" ? JSON.parse(arows[0].data) : arows[0].data : null;
            const aOrderId = String(aDoc?.orderId || aDoc?.id || "").trim();
            if (!aDoc || aOrderId === cleanOrderId) {
              await mysqlPool.query(
                "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
                ["active_orders", tcDriverPhone]
              ).catch(() => {
              });
              for (const col of ["driver_locations", "driver_users", "squad_members"]) {
                try {
                  const [drows] = await mysqlPool.query(
                    "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                    [col, tcDriverPhone]
                  );
                  if (drows && drows.length > 0) {
                    const dd = typeof drows[0].data === "string" ? JSON.parse(drows[0].data) : drows[0].data;
                    dd.isBusy = false;
                    dd.lastStatusUpdateTime = Date.now();
                    await mysqlPool.query(
                      "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
                      [JSON.stringify(dd), col, tcDriverPhone]
                    );
                  }
                } catch (_) {
                }
              }
            }
          } catch (_) {
          }
        }
        try {
          const jdb = readLocalJsonDb();
          for (const col of tcCols) {
            if (!jdb[col]) jdb[col] = {};
            jdb[col][cleanOrderId] = applyCancel(jdb[col][cleanOrderId] || tcExisting[col]);
          }
          if (tcDriverPhone) {
            if (jdb["passenger_links"]?.[tcDriverPhone]) delete jdb["passenger_links"][tcDriverPhone];
            const aDocJ = jdb["active_orders"]?.[tcDriverPhone];
            const aOrderIdJ = String(aDocJ?.orderId || aDocJ?.id || "").trim();
            if (!aDocJ || aOrderIdJ === cleanOrderId) {
              if (jdb["active_orders"]) delete jdb["active_orders"][tcDriverPhone];
              for (const col of ["driver_locations", "driver_users", "squad_members"]) {
                if (jdb[col]?.[tcDriverPhone]) {
                  jdb[col][tcDriverPhone] = { ...jdb[col][tcDriverPhone], isBusy: false, lastStatusUpdateTime: now };
                }
              }
            }
          }
          writeLocalJsonDb(jdb);
        } catch (_) {
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of tcCols) {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][cleanOrderId] = applyCancel(tcExisting[col]);
        }
        if (tcDriverPhone && dbData["passenger_links"] && dbData["passenger_links"][tcDriverPhone]) {
          delete dbData["passenger_links"][tcDriverPhone];
        }
        if (tcDriverPhone) {
          const aDoc = dbData["active_orders"]?.[tcDriverPhone];
          const aOrderId = String(aDoc?.orderId || aDoc?.id || "").trim();
          if (!aDoc || aOrderId === cleanOrderId) {
            if (dbData["active_orders"]) delete dbData["active_orders"][tcDriverPhone];
            for (const col of ["driver_locations", "driver_users", "squad_members"]) {
              if (dbData[col]?.[tcDriverPhone]) {
                dbData[col][tcDriverPhone] = { ...dbData[col][tcDriverPhone], isBusy: false, lastStatusUpdateTime: now };
              }
            }
          }
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Order True Cancel] error:", err);
      res.status(500).json({ success: false, error: err.message || "Order True Cancel Error" });
    }
  });
  app.post("/api/squad-member/approve", requireDbAuth, async (req, res) => {
    try {
      const isApproverAdmin = req.isAdmin || req.isManager || req.isDispatcher;
      if (!isApproverAdmin) {
        return res.status(403).json({ success: false, error: "\u4EC5\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u5BA1\u6279" });
      }
      const { phone, name, approvedBy, approvedRole, note, city } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u662F\u53F8\u673A\uFF0C\u4E0D\u80FD\u6267\u884C\u6B64\u64CD\u4F5C" });
      }
      const cleanName = String(name || "").trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanName) {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      {
        const appDocForApprove = await Promise.resolve(readStatusDocument("squad_applications", cleanPhone)).catch(() => null);
        const memberDocForApprove = await Promise.resolve(readStatusDocument("squad_members", cleanPhone)).catch(() => null);
        if (!appDocForApprove && !memberDocForApprove) {
          return res.status(400).json({ success: false, error: "\u8BE5\u53F8\u673A\u6CA1\u6709\u5165\u961F\u7533\u8BF7\u8BB0\u5F55\uFF0C\u4E0D\u80FD\u76F4\u63A5\u5BA1\u6279\uFF08\u8BF7\u5148\u8BA9\u53F8\u673A\u63D0\u4EA4\u7533\u8BF7\uFF09" });
        }
      }
      let resolvedName = cleanName;
      if (isGenericDriverName(cleanName, cleanPhone)) {
        const fromRecords = await resolveRealNameFromRecords(cleanPhone).catch(() => "");
        if (fromRecords) resolvedName = fromRecords;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const nowTs = Date.now();
      const realApprover = String(req.authPhone || approvedBy || "").trim();
      let keepRole = "\u666E\u901A\u53F8\u673A";
      let keepVipExpiry = "\u5F85\u5F00\u901A";
      let keepLicenseExpiry = "\u5F85\u5F00\u901A";
      try {
        if (isMySQLEnabled && mysqlPool) {
          const [duRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["driver_users", cleanPhone]
          );
          if (duRows && duRows.length > 0) {
            const duData = typeof duRows[0].data === "string" ? JSON.parse(duRows[0].data) : duRows[0].data;
            if (duData?.vipExpiry) keepVipExpiry = duData.vipExpiry;
            if (duData?.licenseExpiry) keepLicenseExpiry = duData.licenseExpiry;
          }
        } else {
          const dbData = readLocalJsonDb();
          const duExisting = dbData.driver_users?.[cleanPhone];
          if (duExisting?.vipExpiry) keepVipExpiry = duExisting.vipExpiry;
          if (duExisting?.licenseExpiry) keepLicenseExpiry = duExisting.licenseExpiry;
        }
        const existing = await readStatusDocument("squad_members", cleanPhone) || readLocalJsonDb().squad_members?.[cleanPhone] || null;
        if (existing?.role && existing.role !== "\u666E\u901A\u53F8\u673A") keepRole = existing.role;
        if (keepVipExpiry === "\u5F85\u5F00\u901A" && existing?.vipExpiry) keepVipExpiry = existing.vipExpiry;
        if (keepLicenseExpiry === "\u5F85\u5F00\u901A" && existing?.licenseExpiry) keepLicenseExpiry = existing.licenseExpiry;
      } catch (_) {
      }
      const memberPayload = {
        id: cleanPhone,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        name: resolvedName,
        driverName: resolvedName,
        role: keepRole,
        userRole: keepRole,
        status: "\u5DF2\u901A\u8FC7",
        approvalStatus: "\u5DF2\u901A\u8FC7",
        approvedBy: realApprover,
        approvedRole: String(approvedRole || ""),
        approvalTime: now,
        note: String(note || "").slice(0, 200),
        city: String(city || "\u94F6\u5DDD\u5E02").slice(0, 20),
        vipExpiry: keepVipExpiry,
        licenseExpiry: keepLicenseExpiry,
        is_squad_member: 1,
        inSquad: true,
        createdAt: nowTs,
        updatedAt: now
      };
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["squad_members", cleanPhone, JSON.stringify(memberPayload)]
        );
        try {
          const [uRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["driver_users", cleanPhone]
          );
          let uExisting = {};
          if (uRows && uRows.length > 0) {
            const raw = uRows[0].data;
            uExisting = typeof raw === "string" ? JSON.parse(raw) : raw;
          }
          const uUpdated = { ...uExisting, ...memberPayload, vipExpiry: uExisting.vipExpiry || "\u5F85\u5F00\u901A" };
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["driver_users", cleanPhone, JSON.stringify(uUpdated)]
          );
        } catch (_) {
        }
        try {
          const teamPayload = { ...memberPayload, squad_position: squadPositionCodeFromRole(keepRole), joinedAt: now };
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["team_members", cleanPhone, JSON.stringify(teamPayload)]
          );
        } catch (_) {
        }
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["squad_applications", cleanPhone]
        ).catch(() => {
        });
        try {
          const [cRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["config", "removed_squad_members"]
          );
          if (cRows && cRows.length > 0) {
            const raw = cRows[0].data;
            const cData = typeof raw === "string" ? JSON.parse(raw) : raw;
            const phones = Array.isArray(cData.phones) ? cData.phones.filter((p) => p !== cleanPhone) : [];
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              ["config", "removed_squad_members", JSON.stringify({ phones, updatedAt: now })]
            );
          }
        } catch (_) {
        }
        syncLocalApprove(cleanPhone, memberPayload);
        try {
          const [alRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["driver_locations", cleanPhone]
          );
          if (alRows && alRows.length > 0) {
            const ald = typeof alRows[0].data === "string" ? JSON.parse(alRows[0].data) : alRows[0].data;
            ald.isOnline = true;
            await mysqlPool.query(
              "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
              [JSON.stringify(ald), "driver_locations", cleanPhone]
            );
          }
        } catch (_) {
        }
        try {
          const ldb = readLocalJsonDb();
          if (ldb["_config"]?.["removedPhones"]) {
            ldb["_config"]["removedPhones"] = (ldb["_config"]["removedPhones"] || []).filter((p) => String(p).trim() !== cleanPhone);
            writeLocalJsonDb(ldb);
          }
        } catch (_) {
        }
      } else {
        const dbData = readLocalJsonDb();
        if (!dbData["squad_members"]) dbData["squad_members"] = {};
        dbData["squad_members"][cleanPhone] = memberPayload;
        if (!dbData["driver_users"]) dbData["driver_users"] = {};
        const uExisting = dbData["driver_users"][cleanPhone] || {};
        dbData["driver_users"][cleanPhone] = { ...uExisting, ...memberPayload, vipExpiry: uExisting.vipExpiry || "\u5F85\u5F00\u901A" };
        if (!dbData["team_members"]) dbData["team_members"] = {};
        dbData["team_members"][cleanPhone] = { ...memberPayload, squad_position: squadPositionCodeFromRole(keepRole), joinedAt: now };
        if (dbData["squad_applications"]?.[cleanPhone]) delete dbData["squad_applications"][cleanPhone];
        if (dbData["driver_locations"]?.[cleanPhone]) dbData["driver_locations"][cleanPhone] = { ...dbData["driver_locations"][cleanPhone], isOnline: true };
        if (dbData["config"]?.["removed_squad_members"]) {
          const phones = (dbData["config"]["removed_squad_members"].phones || []).filter((p) => p !== cleanPhone);
          dbData["config"]["removed_squad_members"] = { phones, updatedAt: now };
        }
        if (dbData["_config"]?.["removedPhones"]) {
          dbData["_config"]["removedPhones"] = (dbData["_config"]["removedPhones"] || []).filter((p) => String(p).trim() !== cleanPhone);
        }
        writeLocalJsonDb(dbData);
      }
      try {
        await logAdminOperation("approve", String(req.authPhone || ""), cleanPhone, "\u5BA1\u6279\u901A\u8FC7\u52A0\u5165\u5C0F\u961F", req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Squad Approve] error:", err);
      res.status(500).json({ success: false, error: err.message || "Approve Error" });
    }
  });
  app.post("/api/squad-member/reject", requireDbAuth, async (req, res) => {
    try {
      const isApproverAdmin = req.isAdmin || req.isManager || req.isDispatcher;
      if (!isApproverAdmin) {
        return res.status(403).json({ success: false, error: "\u4EC5\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u62D2\u7EDD\u7533\u8BF7" });
      }
      const { phone, reason } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u662F\u53F8\u673A\uFF0C\u4E0D\u80FD\u6267\u884C\u6B64\u64CD\u4F5C" });
      }
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const realRejecter = String(req.authPhone || "").trim();
      const finalReason = String(reason || "").trim().slice(0, 200) || "\u7533\u8BF7\u4FE1\u606F\u4E0D\u7B26\u5408\u5C0F\u961F\u8981\u6C42\uFF0C\u8BF7\u5B8C\u5584\u540E\u91CD\u65B0\u7533\u8BF7\u3002";
      const rejectData = {
        status: "\u5DF2\u62D2\u7EDD",
        approvalStatus: "\u5DF2\u62D2\u7EDD",
        rejectedBy: realRejecter,
        rejectionReason: finalReason,
        rejectionTime: now,
        updatedAt: now
      };
      const existingAppDoc = await readStatusDocument("squad_applications", cleanPhone);
      if (!existingAppDoc) {
        return res.status(404).json({ success: false, error: "\u7533\u8BF7\u4E0D\u5B58\u5728" });
      }
      const existingAppStatus = String(existingAppDoc.status || existingAppDoc.approvalStatus || "").trim();
      if (existingAppStatus === "\u5DF2\u62D2\u7EDD") {
        return res.json({ success: true, alreadyRejected: true });
      }
      if (!["\u5F85\u5BA1\u6838", "pending", "\u5BA1\u6838\u4E2D"].includes(existingAppStatus)) {
        return res.status(409).json({ success: false, error: "\u5F53\u524D\u7533\u8BF7\u72B6\u6001\u4E0D\u53EF\u62D2\u7EDD" });
      }
      const membershipForReject = await getUnifiedMembership(cleanPhone);
      if (membershipForReject.isMember) {
        return res.status(409).json({ success: false, error: "\u8BE5\u53F8\u673A\u5DF2\u662F\u5C0F\u961F\u6210\u5458" });
      }
      if (isMySQLEnabled && mysqlPool) {
        let existing = {};
        try {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["squad_applications", cleanPhone]
          );
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            existing = typeof raw === "string" ? JSON.parse(raw) : raw;
          }
        } catch (_) {
        }
        const merged = { ...existing, ...rejectData, phone: cleanPhone };
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["squad_applications", cleanPhone, JSON.stringify(merged)]
        );
        syncLocalReject(cleanPhone, merged);
      } else {
        const dbData = readLocalJsonDb() || {};
        if (!dbData.squad_applications) dbData.squad_applications = {};
        const existing = dbData.squad_applications[cleanPhone] || {};
        dbData.squad_applications[cleanPhone] = { ...existing, ...rejectData, phone: cleanPhone };
        writeLocalJsonDb(dbData);
      }
      try {
        await logAdminOperation("reject", String(req.authPhone || ""), cleanPhone, "\u62D2\u7EDD\u5165\u961F\u7533\u8BF7", req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Squad Reject] error:", err);
      res.status(500).json({ success: false, error: err.message || "Reject Error" });
    }
  });
  const handleOnlineApplicationDecision = async (req, res, approve) => {
    try {
      const isApproverAdmin = req.isAdmin || req.isManager || req.isDispatcher;
      if (!isApproverAdmin) {
        return res.status(403).json({ success: false, error: "\u4EC5\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u5BA1\u6279\u7EBF\u4E0A\u5355\u8D44\u8D28" });
      }
      const { phone, reason } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const existingApp = await readCanonicalDocument("online_applications", cleanPhone);
      if (!existingApp) {
        return res.status(404).json({ success: false, error: "\u7533\u8BF7\u4E0D\u5B58\u5728" });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const operator = String(req.authPhone || "").trim();
      const appUpdated = {
        ...existingApp,
        phone: cleanPhone,
        status: approve ? "approved" : "rejected",
        approvalStatus: approve ? "approved" : "rejected",
        updatedAt: now
      };
      if (approve) {
        appUpdated.approvedBy = operator;
        appUpdated.approvalTime = now;
      } else {
        appUpdated.rejectedBy = operator;
        appUpdated.rejectionReason = String(reason || "").trim().slice(0, 200) || "\u4FE1\u606F\u8D44\u8D28\u6838\u9A8C\u5B58\u5728\u504F\u5DEE\uFF0C\u8BF7\u91CD\u65B0\u63D0\u4EA4\u9AD8\u6E05\u5408\u89C4\u8BC1\u7167\u3002";
        appUpdated.rejectionTime = now;
      }
      const existingDriver = await readCanonicalDocument("driver_users", cleanPhone);
      const driverUpdated = existingDriver && Object.keys(existingDriver).length > 0 ? {
        ...existingDriver,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        onlineOrdersEnabled: approve,
        updatedAt: now
      } : null;
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["online_applications", cleanPhone, JSON.stringify(appUpdated)]
        );
        if (driverUpdated) {
          await mysqlPool.query(
            "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
            ["driver_users", cleanPhone, JSON.stringify(driverUpdated)]
          );
        }
      }
      try {
        const dbData = readLocalJsonDb();
        if (!dbData.online_applications) dbData.online_applications = {};
        dbData.online_applications[cleanPhone] = appUpdated;
        if (driverUpdated) {
          if (!dbData.driver_users) dbData.driver_users = {};
          dbData.driver_users[cleanPhone] = driverUpdated;
        }
        writeLocalJsonDb(dbData);
      } catch (_) {
      }
      try {
        await logAdminOperation(approve ? "online-approve" : "online-reject", operator, cleanPhone, approve ? "\u7EBF\u4E0A\u5355\u8D44\u8D28\u5BA1\u6279\u901A\u8FC7" : "\u7EBF\u4E0A\u5355\u8D44\u8D28\u9A73\u56DE", req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Online Application Decision] error:", err);
      return res.status(500).json({ success: false, error: err.message || "Online Application Error" });
    }
  };
  app.post("/api/online-application/approve", requireDbAuth, (req, res) => handleOnlineApplicationDecision(req, res, true));
  app.post("/api/online-application/reject", requireDbAuth, (req, res) => handleOnlineApplicationDecision(req, res, false));
  app.post("/api/squad-member/rename", requireDbAuth, async (req, res) => {
    try {
      if (!req.isAdmin && !req.isManager) {
        return res.status(403).json({ success: false, error: "\u4EC5\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u6539\u540D" });
      }
      const { phone, name } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u662F\u53F8\u673A\uFF0C\u4E0D\u80FD\u6267\u884C\u6B64\u64CD\u4F5C" });
      }
      const cleanName = String(name || "").trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanName) {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      const operatorPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      if (cleanPhone === "15509601222" && !req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u5F00\u53D1\u8005\u59D3\u540D\u4E0D\u53EF\u4FEE\u6539" });
      }
      if (cleanPhone !== operatorPhone && !req.isAdmin) {
        const targetM = await Promise.resolve(getUnifiedMembership(cleanPhone)).catch(() => null);
        const operatorM = await Promise.resolve(getUnifiedMembership(operatorPhone)).catch(() => null);
        if (membershipLevelUnified(targetM) >= membershipLevelUnified(operatorM)) {
          return res.status(403).json({ success: false, error: "\u4E0D\u80FD\u4FEE\u6539\u540C\u7EA7\u6216\u4E0A\u7EA7\u6210\u5458\u7684\u59D3\u540D" });
        }
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const updatePayload = { name: cleanName, driverName: cleanName, realName: cleanName, applicantName: cleanName, updatedAt: now };
      const cols = ["squad_members", "driver_users", "driver_locations", "online_applications", "squad_applications", "team_members"];
      let syncFailures = 0;
      if (isMySQLEnabled && mysqlPool) {
        for (const col of cols) {
          try {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, cleanPhone]
            );
            if (rows && rows.length > 0) {
              const raw = rows[0].data;
              const existing = typeof raw === "string" ? JSON.parse(raw) : raw;
              const updated = { ...existing, ...updatePayload };
              await mysqlPool.query(
                "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                [col, cleanPhone, JSON.stringify(updated)]
              );
            }
          } catch (_) {
            syncFailures++;
          }
        }
        try {
          const dbData = readLocalJsonDb();
          for (const col of cols) {
            if (dbData[col]?.[cleanPhone]) {
              dbData[col][cleanPhone] = { ...dbData[col][cleanPhone], ...updatePayload };
            }
          }
          writeLocalJsonDb(dbData);
        } catch (_) {
          syncFailures++;
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of cols) {
          if (dbData[col]?.[cleanPhone]) {
            dbData[col][cleanPhone] = { ...dbData[col][cleanPhone], ...updatePayload };
          }
        }
        writeLocalJsonDb(dbData);
      }
      if (syncFailures > 0) {
        return res.status(500).json({ success: false, error: "\u6539\u540D\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      _authoritativeNameCache.delete(cleanPhone);
      try {
        await logAdminOperation("rename", operatorPhone, cleanPhone, `\u6539\u540D\u4E3A ${cleanName}`, req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Squad Rename] error:", err);
      res.status(500).json({ success: false, error: err.message || "Rename Error" });
    }
  });
  app.post("/api/squad-member/set-role", requireDbAuth, async (req, res) => {
    try {
      if (!req.isAdmin && !req.isManager && !req.isDispatcher) {
        return res.status(403).json({ success: false, error: "\u4EC5\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u8C03\u6574\u804C\u4F4D" });
      }
      const { phone, role, city, remark } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u662F\u53F8\u673A\uFF0C\u4E0D\u80FD\u6267\u884C\u6B64\u64CD\u4F5C" });
      }
      const cleanRole = String(role || "").trim().slice(0, 20);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanRole) {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      if (cleanPhone === "15509601222") {
        return res.status(403).json({ success: false, error: "\u5F00\u53D1\u8005\u89D2\u8272\u4E0D\u53EF\u8C03\u6574" });
      }
      const ROLE_WHITELIST = {
        "\u666E\u901A\u53F8\u673A": "\u666E\u901A\u53F8\u673A",
        "\u666E\u901A": "\u666E\u901A\u53F8\u673A",
        "\u57CE\u5E02\u6D3E\u5355\u5458": "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A",
        "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A": "\u57CE\u5E02\u6D3E\u5355\u5458\u53F8\u673A",
        "\u57CE\u5E02\u7BA1\u7406": "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A",
        "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A": "\u57CE\u5E02\u7BA1\u7406\u53F8\u673A",
        "\u57CE\u5E02\u8001\u677F": "\u57CE\u5E02\u8001\u677F\u53F8\u673A",
        "\u57CE\u5E02\u8001\u677F\u53F8\u673A": "\u57CE\u5E02\u8001\u677F\u53F8\u673A",
        "\u603B\u6307\u6325\u5B98": "\u57CE\u5E02\u8001\u677F\u53F8\u673A"
      };
      const canonicalRole = ROLE_WHITELIST[cleanRole];
      if (!canonicalRole) {
        return res.status(400).json({ success: false, error: "\u89D2\u8272\u4E0D\u5408\u6CD5" });
      }
      const operatorPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      const targetM = await Promise.resolve(getUnifiedMembership(cleanPhone)).catch(() => null);
      if (!targetM || !targetM.isMember) {
        return res.status(404).json({ success: false, error: "\u8BE5\u53F8\u673A\u4E0D\u662F\u5C0F\u961F\u6210\u5458\uFF0C\u65E0\u6CD5\u8C03\u6574\u804C\u4F4D" });
      }
      if (!req.isAdmin) {
        const operatorM = await Promise.resolve(getUnifiedMembership(operatorPhone)).catch(() => null);
        const opLevel = membershipLevelUnified(operatorM);
        const targetLevel = membershipLevelUnified(targetM);
        const newLevel = membershipLevelUnified({ role: canonicalRole });
        if (req.isDispatcher && !req.isManager) {
          if (newLevel !== 0 || targetLevel !== 0) {
            return res.status(403).json({ success: false, error: "\u6D3E\u5355\u5458\u53EA\u80FD\u8C03\u6574\u666E\u901A\u53F8\u673A\u7684\u804C\u4F4D" });
          }
        } else if (cleanPhone === operatorPhone) {
          if (newLevel >= opLevel) {
            return res.status(403).json({ success: false, error: "\u4E0D\u80FD\u63D0\u5347\u81EA\u5DF1\u7684\u804C\u4F4D" });
          }
        } else if (!(opLevel > targetLevel && newLevel < opLevel)) {
          return res.status(403).json({ success: false, error: "\u53EA\u80FD\u628A\u804C\u4F4D\u8C03\u6574\u7ED9\u7B49\u7EA7\u4F4E\u4E8E\u81EA\u5DF1\u7684\u6210\u5458\u3001\u4E14\u4E0D\u80FD\u6388\u4E88\u4E0D\u4F4E\u4E8E\u81EA\u5DF1\u7684\u804C\u4F4D" });
        }
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const updatePayload = { role: canonicalRole, userRole: canonicalRole, updatedAt: now };
      if (city !== void 0 && String(city).trim()) updatePayload.city = String(city).trim().slice(0, 20);
      if (remark !== void 0) updatePayload.remark = String(remark).trim().slice(0, 100);
      const positionCode = squadPositionCodeFromRole(canonicalRole);
      const cols = ["squad_members", "driver_users", "squad_applications", "team_members"];
      let syncFailures = 0;
      const applyRoleLocal = (dbData) => {
        for (const col of cols) {
          if (dbData[col]?.[cleanPhone]) {
            const updated = { ...dbData[col][cleanPhone], ...updatePayload };
            if (col === "team_members" || col === "squad_members") updated.squad_position = positionCode;
            dbData[col][cleanPhone] = updated;
          }
        }
      };
      if (isMySQLEnabled && mysqlPool) {
        for (const col of cols) {
          try {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, cleanPhone]
            );
            if (rows && rows.length > 0) {
              const raw = rows[0].data;
              const existing = typeof raw === "string" ? JSON.parse(raw) : raw;
              const updated = { ...existing, ...updatePayload };
              if (col === "team_members" || col === "squad_members") {
                updated.squad_position = positionCode;
              }
              await mysqlPool.query(
                "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                [col, cleanPhone, JSON.stringify(updated)]
              );
            }
          } catch (_) {
            syncFailures++;
          }
        }
        try {
          const dbData = readLocalJsonDb();
          applyRoleLocal(dbData);
          writeLocalJsonDb(dbData);
        } catch (_) {
          syncFailures++;
        }
      } else {
        const dbData = readLocalJsonDb();
        applyRoleLocal(dbData);
        writeLocalJsonDb(dbData);
      }
      if (syncFailures > 0) {
        return res.status(500).json({ success: false, error: "\u804C\u4F4D\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      try {
        await logAdminOperation("set-role", operatorPhone, cleanPhone, `\u804C\u4F4D\u8C03\u6574\u4E3A ${canonicalRole}`, req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Squad Set Role] error:", err);
      res.status(500).json({ success: false, error: err.message || "Set Role Error" });
    }
  });
  app.post("/api/squad-member/remove", requireDbAuth, async (req, res) => {
    try {
      if (!req.isAdmin && !req.isManager) {
        return res.status(403).json({ success: false, error: "\u4EC5\u7BA1\u7406\u4EBA\u5458\u53EF\u4EE5\u5220\u9664\u53F8\u673A" });
      }
      const { phone, adminPhone } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\uFF08A\u540E\u7F00\uFF09\u4E0D\u662F\u53F8\u673A\uFF0C\u4E0D\u80FD\u6267\u884C\u6B64\u64CD\u4F5C" });
      }
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      if (cleanPhone === "15509601222") {
        return res.status(403).json({ success: false, error: "\u5F00\u53D1\u8005\u4E0D\u80FD\u88AB\u5220\u9664" });
      }
      if (!req.isAdmin) {
        const operatorPhoneRm = String(req.authPhone || "").replace(/\D/g, "").trim();
        const operatorMRm = await Promise.resolve(getUnifiedMembership(operatorPhoneRm)).catch(() => null);
        const targetMRm = await Promise.resolve(getUnifiedMembership(cleanPhone)).catch(() => null);
        const opLevelRm = membershipLevelUnified(operatorMRm);
        const tgLevelRm = targetMRm && targetMRm.isMember ? membershipLevelUnified(targetMRm) : 0;
        if (!(opLevelRm > tgLevelRm)) {
          return res.status(403).json({ success: false, error: "\u4E0D\u80FD\u5220\u9664\u540C\u7EA7\u6216\u4E0A\u7EA7\u6210\u5458" });
        }
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["squad_members", cleanPhone]
        );
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["squad_applications", cleanPhone]
        );
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["team_members", cleanPhone]
        ).catch(() => {
        });
        const [uRows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          ["driver_users", cleanPhone]
        );
        let uData = {};
        if (uRows && uRows.length > 0) {
          const raw = uRows[0].data;
          uData = typeof raw === "string" ? JSON.parse(raw) : raw;
        }
        const realRemover = String(req.authPhone || adminPhone || "").trim();
        uData = {
          ...uData,
          phone: cleanPhone,
          phoneNumber: cleanPhone,
          role: "\u666E\u901A\u53F8\u673A",
          userRole: "\u666E\u901A\u53F8\u673A",
          status: "\u672A\u52A0\u5165\u5C0F\u961F",
          approvalStatus: "\u672A\u52A0\u5165\u5C0F\u961F",
          is_squad_member: 0,
          inSquad: false,
          isOnline: false,
          // 2026-10-23 第十六轮：与定位表同口径标离线（此前只清定位，driver_users.isOnline 残留 true 且看门狗不扫此表，永不自愈）
          removedBy: realRemover,
          removedAt: now,
          updatedAt: now
        };
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["driver_users", cleanPhone, JSON.stringify(uData)]
        );
        const [cRows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          ["config", "removed_squad_members"]
        );
        let phones = [];
        if (cRows && cRows.length > 0) {
          const raw = cRows[0].data;
          const cData = typeof raw === "string" ? JSON.parse(raw) : raw;
          phones = Array.isArray(cData.phones) ? cData.phones : [];
        }
        if (!phones.includes(cleanPhone)) phones.push(cleanPhone);
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["config", "removed_squad_members", JSON.stringify({ phones, updatedAt: now })]
        );
        try {
          const [lRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["driver_locations", cleanPhone]
          );
          if (lRows && lRows.length > 0) {
            const ld = typeof lRows[0].data === "string" ? JSON.parse(lRows[0].data) : lRows[0].data;
            ld.isOnline = false;
            ld.isBusy = false;
            await mysqlPool.query(
              "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
              [JSON.stringify(ld), "driver_locations", cleanPhone]
            );
          }
        } catch (_) {
        }
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["online_applications", cleanPhone]
        ).catch(() => {
        });
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["passenger_links", cleanPhone]
        ).catch(() => {
        });
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["active_orders", cleanPhone]
        ).catch(() => {
        });
        syncLocalRemove(cleanPhone, uData);
      } else {
        const dbData = readLocalJsonDb();
        if (dbData["squad_members"]?.[cleanPhone]) delete dbData["squad_members"][cleanPhone];
        if (dbData["squad_applications"]?.[cleanPhone]) delete dbData["squad_applications"][cleanPhone];
        if (dbData["team_members"]?.[cleanPhone]) delete dbData["team_members"][cleanPhone];
        if (dbData["driver_locations"]?.[cleanPhone]) dbData["driver_locations"][cleanPhone] = { ...dbData["driver_locations"][cleanPhone], isOnline: false, isBusy: false };
        if (dbData["online_applications"]?.[cleanPhone]) delete dbData["online_applications"][cleanPhone];
        if (dbData["passenger_links"]?.[cleanPhone]) delete dbData["passenger_links"][cleanPhone];
        if (dbData["active_orders"]?.[cleanPhone]) delete dbData["active_orders"][cleanPhone];
        if (!dbData["driver_users"]) dbData["driver_users"] = {};
        const existing = dbData["driver_users"][cleanPhone] || {};
        dbData["driver_users"][cleanPhone] = {
          ...existing,
          phone: cleanPhone,
          phoneNumber: cleanPhone,
          role: "\u666E\u901A\u53F8\u673A",
          userRole: "\u666E\u901A\u53F8\u673A",
          status: "\u672A\u52A0\u5165\u5C0F\u961F",
          approvalStatus: "\u672A\u52A0\u5165\u5C0F\u961F",
          is_squad_member: 0,
          inSquad: false,
          isOnline: false,
          // 2026-10-23 第十六轮：同 MySQL 分支，移除即双表离线
          removedBy: String(req.authPhone || adminPhone || ""),
          removedAt: now,
          updatedAt: now
        };
        if (!dbData["config"]) dbData["config"] = {};
        const cfg = dbData["config"]["removed_squad_members"] || { phones: [] };
        const phones = Array.isArray(cfg.phones) ? cfg.phones : [];
        if (!phones.includes(cleanPhone)) phones.push(cleanPhone);
        dbData["config"]["removed_squad_members"] = { phones, updatedAt: now };
        writeLocalJsonDb(dbData);
      }
      try {
        await logAdminOperation("remove", String(req.authPhone || ""), cleanPhone, "\u79FB\u51FA\u5C0F\u961F", req);
      } catch (_) {
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Squad Remove] error:", err);
      res.status(500).json({ success: false, error: err.message || "Squad Remove Error" });
    }
  });
  app.post("/api/order/driver-claim", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, driverName } = req.body || {};
      const cleanOrderId = String(orderId || "").trim();
      const authPhoneRawClaim = String(req.authPhone || "").trim();
      if (/a$/i.test(authPhoneRawClaim)) {
        return res.status(403).json({ success: false, error: "\u5546\u6237\u8EAB\u4EFD\u4E0D\u80FD\u62A2\u5355" });
      }
      const cleanDriverPhone = authPhoneRawClaim.replace(/\D/g, "").trim();
      const cleanDriverName = String(driverName || "").slice(0, 20);
      if (!cleanOrderId || !/^1[3-9]\d{9}$/.test(cleanDriverPhone)) {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      try {
        const licExpiry2 = (await readDriverExpiryUnified(cleanDriverPhone)).licenseExpiry;
        if (!isLicenseValid(licExpiry2)) {
          return res.status(403).json({ success: false, error: "\u63A5\u5355\u6388\u6743\u5DF2\u5230\u671F\uFF0C\u8BF7\u8054\u7CFB\u5F00\u53D1\u8005\u5145\u503C" });
        }
      } catch (e) {
        console.error("[DriverClaim] \u63A5\u5355\u6388\u6743\u6821\u9A8C\u5F02\u5E38:", e?.message);
        return res.status(503).json({ success: false, error: "\u6388\u6743\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      try {
        const vipExpiry2 = (await readDriverExpiryUnified(cleanDriverPhone)).vipExpiry;
        if (!isVipActiveServer(vipExpiry2)) {
          const todayCount = await countTodayCompletedOrders(cleanDriverPhone);
          if (todayCount >= 2) {
            return res.status(403).json({ success: false, error: "\u975EVIP\u4F1A\u5458\u6BCF\u5929\u96502\u5355\uFF0C\u660E\u65E96\u70B9\u81EA\u52A8\u6062\u590D\u3002\u5982\u9700\u65E0\u9650\u63A5\u5355\u8BF7\u5F00\u901AVIP" });
          }
        }
      } catch (e) {
        console.error("[DriverClaim] VIP\u9650\u989D\u6821\u9A8C\u5F02\u5E38:", e?.message);
      }
      const checkSquadMember = async () => {
        if (cleanDriverPhone === "15509601222") return true;
        try {
          if (isMySQLEnabled && mysqlPool) {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["squad_members", cleanDriverPhone]
            );
            if (!rows || rows.length === 0) return false;
            const raw = rows[0].data;
            const m = typeof raw === "string" ? JSON.parse(raw) : raw;
            const st = String(m.status || m.approvalStatus || "").trim();
            return ["\u5DF2\u901A\u8FC7", "approved", "\u901A\u8FC7"].includes(st);
          } else {
            const dbData = readLocalJsonDb();
            const m = (dbData["squad_members"] || {})[cleanDriverPhone];
            if (!m) return false;
            const st = String(m.status || m.approvalStatus || "").trim();
            return ["\u5DF2\u901A\u8FC7", "approved", "\u901A\u8FC7"].includes(st);
          }
        } catch (_) {
          return false;
        }
      };
      if (cleanDriverPhone !== "15509601222") {
        const removedForClaim = await readRemovedPhonesMergedUnified();
        if (removedForClaim.includes(cleanDriverPhone)) {
          return res.status(403).json({ success: false, error: "\u60A8\u5DF2\u88AB\u79FB\u51FA\u5C0F\u961F\uFF0C\u8BF7\u91CD\u65B0\u7533\u8BF7\u52A0\u5165" });
        }
      }
      if (!await checkSquadMember()) {
        return res.status(403).json({ success: false, error: "\u4EC5\u5C0F\u961F\u6B63\u5F0F\u6210\u5458\u53EF\u63A5\u5355" });
      }
      try {
        if (isMySQLEnabled && mysqlPool) {
          const [idemRows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["merchant_orders", cleanOrderId]
          );
          if (idemRows && idemRows.length > 0) {
            const idemRaw = idemRows[0].data;
            const idemTarget = typeof idemRaw === "string" ? JSON.parse(idemRaw) : idemRaw;
            const idemClaimedBy = String(idemTarget.claimedDriverPhone || idemTarget.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
            const idemSt = String(idemTarget.status || "");
            if ((idemSt === "claimed" || idemSt === "\u5DF2\u63A5\u5355") && idemClaimedBy === cleanDriverPhone) {
              return res.json({ success: true });
            }
          }
        } else {
          const idemLocal = readLocalJsonDb()?.merchant_orders?.[cleanOrderId];
          if (idemLocal) {
            const idemClaimedBy = String(idemLocal.claimedDriverPhone || idemLocal.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
            const idemSt = String(idemLocal.status || "");
            if ((idemSt === "claimed" || idemSt === "\u5DF2\u63A5\u5355") && idemClaimedBy === cleanDriverPhone) {
              return res.json({ success: true });
            }
          }
        }
      } catch (_) {
      }
      try {
        let busyLoc = null;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [brows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              ["driver_locations", cleanDriverPhone]
            );
            if (brows && brows.length > 0) {
              const braw = brows[0].data;
              busyLoc = typeof braw === "string" ? JSON.parse(braw) : braw;
            }
          } catch (_) {
          }
        }
        if (!busyLoc) busyLoc = readLocalJsonDb()?.driver_locations?.[cleanDriverPhone];
        if (busyLoc && (busyLoc.isBusy === true || busyLoc.isBusy === "true" || busyLoc.isBusy === 1)) {
          return res.status(409).json({ success: false, error: "\u60A8\u5F53\u524D\u6709\u884C\u7A0B\u4E2D\u7684\u8BA2\u5355\uFF0C\u8BF7\u5B8C\u6210\u540E\u518D\u62A2\u5355" });
        }
      } catch (_) {
      }
      try {
        const pendClaim = await getPendingDispatchForPhone(cleanDriverPhone, true);
        if (pendClaim && pendClaim.orderId !== cleanOrderId) {
          return res.status(409).json({ success: false, error: "\u60A8\u6709\u5F85\u5904\u7406\u7684\u6D3E\u5355\uFF0C\u8BF7\u5148\u5904\u7406\u540E\u518D\u62A2\u5355" });
        }
      } catch (_) {
      }
      try {
        const activeOtherDc = await findDriverActiveOrderId(cleanDriverPhone, cleanOrderId);
        if (activeOtherDc) {
          return res.status(409).json({ success: false, error: "\u60A8\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u8BA2\u5355\uFF0C\u8BF7\u5B8C\u6210\u540E\u518D\u62A2\u5355" });
        }
      } catch (_) {
      }
      try {
        if (!req.isAdmin) {
          const hallOrderDoc = await Promise.resolve(readCanonicalDocument("merchant_orders", cleanOrderId));
          const declinedList = [
            ...Array.isArray(hallOrderDoc?.declinedDriverPhones) ? hallOrderDoc.declinedDriverPhones : [],
            ...Array.isArray(hallOrderDoc?.timeoutDriverPhones) ? hallOrderDoc.timeoutDriverPhones : []
          ].map((v) => String(v || "").replace(/\D/g, "").trim());
          if (declinedList.includes(cleanDriverPhone)) {
            return res.status(409).json({ success: false, error: "\u60A8\u5DF2\u62D2\u5355\u6216\u8D85\u65F6\u672A\u63A5\u6B64\u5355\uFF0C\u4E0D\u80FD\u518D\u62A2\u6B64\u5355" });
          }
        }
      } catch (_) {
      }
      try {
        const hallOrderDocRt = await Promise.resolve(readCanonicalDocument("merchant_orders", cleanOrderId));
        const reporterOfOrder = String(hallOrderDocRt?.reporterPhone || "").replace(/\D/g, "").trim();
        if (reporterOfOrder && reporterOfOrder === cleanDriverPhone) {
          return res.status(409).json({ success: false, error: "\u4E0D\u80FD\u62A2\u81EA\u5DF1\u62A5\u5355\u8F6C\u5355\u7684\u8BA2\u5355" });
        }
      } catch (_) {
      }
      const now = Date.now();
      const claimData = {
        status: "claimed",
        statusCategory: "\u5DF2\u63A5\u5355",
        in_hall: false,
        dispatchedDriverPhone: cleanDriverPhone,
        dispatchedDriverName: cleanDriverName,
        claimedDriverPhone: cleanDriverPhone,
        claimedDriverName: cleanDriverName,
        driverName: cleanDriverName,
        claimedAt: now
      };
      const doClaim = async () => {
        if (isMySQLEnabled && mysqlPool) {
          const [rows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["merchant_orders", cleanOrderId]
          );
          let target = {};
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            target = typeof raw === "string" ? JSON.parse(raw) : raw;
          }
          const claimedBy = String(target.claimedDriverPhone || target.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
          const st = String(target.status || "");
          if ((st === "claimed" || st === "\u5DF2\u63A5\u5355") && claimedBy === cleanDriverPhone) {
            return { ok: true };
          }
          if ((st === "claimed" || st === "\u5DF2\u63A5\u5355") && claimedBy && claimedBy !== cleanDriverPhone) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u5DF2\u88AB\u5176\u4ED6\u53F8\u673A\u63A5\u5355" };
          }
          if (st === "dispatched" && target.dispatchedDriverPhone && !target.in_hall) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u6B63\u5728\u6D3E\u5355\u4E2D\uFF0C\u8BF7\u7B49\u5F85" };
          }
          const inHall = target.in_hall === true || st === "hall" || st === "\u7B49\u5F85\u63A5\u5355";
          if (!inHall) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u4E0D\u5728\u9009\u5355\u5927\u5385\uFF0C\u65E0\u6CD5\u62A2\u5355" };
          }
          if (st === "cancelled" || st === "\u5DF2\u53D6\u6D88" || target.isCancelled) {
            return { ok: false, code: 410, error: "\u8BE5\u8BA2\u5355\u5DF2\u53D6\u6D88" };
          }
          const updated = { ...target, ...claimData };
          const [updRes] = await mysqlPool.query(
            "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '') NOT IN ('claimed', '\u5DF2\u63A5\u5355', 'cancelled', '\u5DF2\u53D6\u6D88') AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.claimedDriverPhone')), '') = '' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.claimedDriverPhone')), '') = ?)",
            [JSON.stringify(updated), "merchant_orders", cleanOrderId, cleanDriverPhone]
          );
          const affected = Number(updRes?.affectedRows || 0);
          if (affected === 0) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u5DF2\u88AB\u5176\u4ED6\u53F8\u673A\u63A5\u5355" };
          }
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = 'passenger_links' AND JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')) = ?",
            [cleanOrderId]
          ).catch(() => {
          });
          try {
            const _cols = ["driver_locations", "driver_users"];
            for (let _ci = 0; _ci < _cols.length; _ci++) {
              await mysqlPool.query(
                'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(TRUE AS JSON)) WHERE `collection` = ? AND `doc_id` = ?',
                [_cols[_ci], cleanDriverPhone]
              ).catch(function() {
              });
            }
          } catch (_) {
          }
          try {
            const jdb = readLocalJsonDb();
            if (!jdb["merchant_orders"]) jdb["merchant_orders"] = {};
            jdb["merchant_orders"][cleanOrderId] = updated;
            if (jdb["passenger_links"]) {
              for (const [k, v] of Object.entries(jdb["passenger_links"])) {
                const vid = String(v?.id || v?.orderId || v?.orderNo || "");
                if (vid === cleanOrderId) delete jdb["passenger_links"][k];
              }
            }
            for (const col of ["driver_locations", "driver_users"]) {
              if (jdb[col]?.[cleanDriverPhone]) {
                jdb[col][cleanDriverPhone] = { ...jdb[col][cleanDriverPhone], isBusy: true, lastStatusUpdateTime: now };
              }
            }
            writeLocalJsonDb(jdb);
          } catch (_) {
          }
          return { ok: true };
        } else {
          const dbData = readLocalJsonDb();
          if (!dbData["merchant_orders"]) dbData["merchant_orders"] = {};
          const target = dbData["merchant_orders"][cleanOrderId] || {};
          const claimedBy = String(target.claimedDriverPhone || target.dispatchedDriverPhone || "").replace(/\D/g, "").trim();
          const st = String(target.status || "");
          if ((st === "claimed" || st === "\u5DF2\u63A5\u5355") && claimedBy === cleanDriverPhone) {
            return { ok: true };
          }
          if ((st === "claimed" || st === "\u5DF2\u63A5\u5355") && claimedBy && claimedBy !== cleanDriverPhone) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u5DF2\u88AB\u5176\u4ED6\u53F8\u673A\u63A5\u5355" };
          }
          if (st === "dispatched" && target.dispatchedDriverPhone && !target.in_hall) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u6B63\u5728\u6D3E\u5355\u4E2D\uFF0C\u8BF7\u7B49\u5F85" };
          }
          const inHallLocal = target.in_hall === true || st === "hall" || st === "\u7B49\u5F85\u63A5\u5355";
          if (!inHallLocal) {
            return { ok: false, code: 409, error: "\u8BE5\u8BA2\u5355\u4E0D\u5728\u9009\u5355\u5927\u5385\uFF0C\u65E0\u6CD5\u62A2\u5355" };
          }
          if (st === "cancelled" || st === "\u5DF2\u53D6\u6D88" || target.isCancelled) {
            return { ok: false, code: 410, error: "\u8BE5\u8BA2\u5355\u5DF2\u53D6\u6D88" };
          }
          dbData["merchant_orders"][cleanOrderId] = { ...target, ...claimData };
          if (dbData["passenger_links"]) {
            for (const [k, v] of Object.entries(dbData["passenger_links"])) {
              const vid = String(v?.id || v?.orderId || v?.orderNo || "");
              if (vid === cleanOrderId) delete dbData["passenger_links"][k];
            }
          }
          for (const col of ["driver_locations", "driver_users"]) {
            if (dbData[col]?.[cleanDriverPhone]) {
              dbData[col][cleanDriverPhone] = { ...dbData[col][cleanDriverPhone], isBusy: true, lastStatusUpdateTime: now };
            }
          }
          writeLocalJsonDb(dbData);
          return { ok: true };
        }
      };
      const result = await doClaim();
      if (!result.ok) {
        return res.status(result.code).json({ success: false, error: result.error });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Order Driver Claim] error:", err);
      res.status(500).json({ success: false, error: err.message || "Driver Claim Error" });
    }
  });
  app.post("/api/order/complete", requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || req.body?.id || "").trim();
      const completeRaw = String(req.authPhone || "").trim();
      if (/a$/i.test(completeRaw)) {
        return res.status(403).json({ success: false, error: "\u5546\u6237\u8EAB\u4EFD\u4E0D\u80FD\u5B8C\u6210\u8BA2\u5355" });
      }
      const authPhone = completeRaw.replace(/\D/g, "").trim();
      if (!orderId || !/^1[3-9]\d{9}$/.test(authPhone)) {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      const now = Date.now();
      if (isMySQLEnabled && mysqlPool) {
        const [rows] = await mysqlPool.query(
          "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
          ["merchant_orders", orderId]
        );
        if (!rows || rows.length === 0) {
          return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
        }
        const od = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
        const claimedBy = String(od.claimedDriverPhone || od.dispatchedDriverPhone || "").replace(/\D/g, "");
        if (claimedBy !== authPhone && authPhone !== "15509601222") {
          return res.status(403).json({ success: false, error: "\u53EA\u80FD\u5B8C\u6210\u81EA\u5DF1\u7684\u8BA2\u5355" });
        }
        if (["cancelled", "\u5DF2\u53D6\u6D88", "completed", "\u5DF2\u5B8C\u6210"].includes(String(od.status || ""))) {
          return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u5B8C\u7ED3\uFF0C\u65E0\u6CD5\u5B8C\u6210" });
        }
        if (!["claimed", "\u5DF2\u63A5\u5355", "arrived", "serving", "in_service", "started"].includes(String(od.status || "")) && !["\u5DF2\u63A5\u5355", "\u670D\u52A1\u4E2D", "\u8BA1\u8D39\u4E2D", "\u8FDB\u884C\u4E2D"].includes(String(od.statusCategory || ""))) {
          return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5C1A\u672A\u63A5\u5355\uFF0C\u65E0\u6CD5\u5B8C\u6210" });
        }
        od.status = "completed";
        od.statusCategory = "\u5DF2\u5B8C\u6210";
        od.completedAt = now;
        od.updatedAt = now;
        {
          const destName = String(req.body?.endLocation || req.body?.destination || req.body?.dropoffName || "").trim();
          if (destName && destName !== "\u4F4D\u7F6E\u672A\u77E5" && destName !== "\u76EE\u7684\u5730\u5B9A\u4F4D\u4E2D..." && !/^(请填写|待指定|未完成|未填写)/.test(destName)) {
            od.endLocation = destName;
            od.destination = destName;
            od.dropoffName = destName;
          }
          const ec = req.body?.endCoords;
          if (ec && typeof ec.lng === "number" && typeof ec.lat === "number" && ec.lng > 0 && ec.lat > 0) {
            od.endCoords = { lng: ec.lng, lat: ec.lat };
          }
          const cdist = Number(req.body?.currentDistance);
          if (!isNaN(cdist) && cdist > 0) {
            od.currentDistance = cdist;
            od.distance = cdist;
          }
        }
        await mysqlPool.query(
          "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
          [JSON.stringify(od), "merchant_orders", orderId]
        );
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? AND (JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')) = ? OR JSON_EXTRACT(`data`, '$.orderId') IS NULL)",
          ["active_orders", claimedBy, String(orderId)]
        ).catch((e) => console.error("[OrderComplete] \u6E05\u7406 active_orders \u5931\u8D25:", e?.message));
        for (const col of ["driver_locations", "driver_users"]) {
          try {
            const [drows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, authPhone]
            );
            if (drows && drows.length > 0) {
              const dd = typeof drows[0].data === "string" ? JSON.parse(drows[0].data) : drows[0].data;
              dd.isBusy = false;
              await mysqlPool.query(
                "UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?",
                [JSON.stringify(dd), col, authPhone]
              );
            }
          } catch (_) {
          }
        }
        try {
          const jdb = readLocalJsonDb();
          if (!jdb["merchant_orders"]) jdb["merchant_orders"] = {};
          jdb["merchant_orders"][orderId] = od;
          if (jdb["active_orders"]?.[claimedBy]) {
            const aDoc = jdb["active_orders"][claimedBy];
            if (!aDoc?.orderId || String(aDoc.orderId) === String(orderId)) delete jdb["active_orders"][claimedBy];
          }
          for (const col of ["driver_locations", "driver_users"]) {
            if (jdb[col]?.[authPhone]) jdb[col][authPhone].isBusy = false;
          }
          writeLocalJsonDb(jdb);
        } catch (_) {
        }
      } else {
        const dbData = readLocalJsonDb();
        const od = dbData["merchant_orders"]?.[orderId];
        if (!od) {
          return res.status(404).json({ success: false, error: "\u8BA2\u5355\u4E0D\u5B58\u5728" });
        }
        const claimedBy = String(od.claimedDriverPhone || od.dispatchedDriverPhone || "").replace(/\D/g, "");
        if (claimedBy !== authPhone && authPhone !== "15509601222") {
          return res.status(403).json({ success: false, error: "\u53EA\u80FD\u5B8C\u6210\u81EA\u5DF1\u7684\u8BA2\u5355" });
        }
        if (["cancelled", "\u5DF2\u53D6\u6D88", "completed", "\u5DF2\u5B8C\u6210"].includes(String(od.status || ""))) {
          return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5DF2\u5B8C\u7ED3\uFF0C\u65E0\u6CD5\u5B8C\u6210" });
        }
        if (!["claimed", "\u5DF2\u63A5\u5355", "arrived", "serving", "in_service", "started"].includes(String(od.status || "")) && !["\u5DF2\u63A5\u5355", "\u670D\u52A1\u4E2D", "\u8BA1\u8D39\u4E2D", "\u8FDB\u884C\u4E2D"].includes(String(od.statusCategory || ""))) {
          return res.status(409).json({ success: false, error: "\u8BA2\u5355\u5C1A\u672A\u63A5\u5355\uFF0C\u65E0\u6CD5\u5B8C\u6210" });
        }
        od.status = "completed";
        od.statusCategory = "\u5DF2\u5B8C\u6210";
        od.completedAt = now;
        od.updatedAt = now;
        {
          const destName = String(req.body?.endLocation || req.body?.destination || req.body?.dropoffName || "").trim();
          if (destName && destName !== "\u4F4D\u7F6E\u672A\u77E5" && destName !== "\u76EE\u7684\u5730\u5B9A\u4F4D\u4E2D..." && !/^(请填写|待指定|未完成|未填写)/.test(destName)) {
            od.endLocation = destName;
            od.destination = destName;
            od.dropoffName = destName;
          }
          const ec = req.body?.endCoords;
          if (ec && typeof ec.lng === "number" && typeof ec.lat === "number" && ec.lng > 0 && ec.lat > 0) {
            od.endCoords = { lng: ec.lng, lat: ec.lat };
          }
          const cdist = Number(req.body?.currentDistance);
          if (!isNaN(cdist) && cdist > 0) {
            od.currentDistance = cdist;
            od.distance = cdist;
          }
        }
        for (const col of ["driver_locations", "driver_users"]) {
          if (dbData[col]?.[authPhone]) {
            dbData[col][authPhone].isBusy = false;
          }
        }
        if (dbData["active_orders"]?.[claimedBy]) {
          const aDoc = dbData["active_orders"][claimedBy];
          if (!aDoc?.orderId || String(aDoc.orderId) === String(orderId)) delete dbData["active_orders"][claimedBy];
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (e) {
      console.error("[OrderComplete] \u5931\u8D25:", e?.message);
      return res.status(500).json({ success: false, error: "\u5B8C\u6210\u8BA2\u5355\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
    }
  });
  app.post("/api/report-transfer/dispatch", requireDbAuth, async (req, res) => {
    try {
      const {
        orderId,
        passengerPhone,
        pickupName,
        pickupDetail,
        pickupLat,
        pickupLng,
        paymentQrCode
      } = req.body || {};
      const reporterRaw = String(req.authPhone || "").trim();
      if (/a$/i.test(reporterRaw)) {
        return res.status(403).json({ success: false, error: "\u5546\u6237\u8EAB\u4EFD\u4E0D\u80FD\u53D1\u8D77\u8F6C\u5355" });
      }
      const cleanReporter = reporterRaw.replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(cleanReporter)) {
        return res.status(401).json({ success: false, error: "\u8EAB\u4EFD\u9A8C\u8BC1\u5931\u8D25" });
      }
      const cleanOrderId = `RT${Date.now()}${Math.floor(Math.random() * 1e3).toString().padStart(3, "0")}`;
      try {
        let repLic = "";
        if (isMySQLEnabled && mysqlPool) {
          const [rrows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["driver_users", cleanReporter]
          );
          if (rrows && rrows.length > 0) {
            const rd = typeof rrows[0].data === "string" ? JSON.parse(rrows[0].data) : rrows[0].data;
            repLic = String(rd.licenseExpiry || "");
          }
        } else {
          repLic = String(readLocalJsonDb()?.driver_users?.[cleanReporter]?.licenseExpiry || "");
        }
        if (!isLicenseValid(repLic)) {
          return res.status(403).json({ success: false, error: "\u63A5\u5355\u6388\u6743\u5DF2\u5230\u671F\uFF0C\u8BF7\u8054\u7CFB\u5F00\u53D1\u8005\u5145\u503C" });
        }
      } catch (e) {
        console.error("[ReportTransfer] \u53D1\u8D77\u4EBA\u6388\u6743\u6821\u9A8C\u5F02\u5E38:", e?.message);
        return res.status(503).json({ success: false, error: "\u6388\u6743\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      try {
        let vipExpiryRT = "";
        if (isMySQLEnabled && mysqlPool) {
          const [vrows] = await mysqlPool.query(
            "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
            ["driver_users", cleanReporter]
          );
          if (vrows && vrows.length > 0) {
            const vd = typeof vrows[0].data === "string" ? JSON.parse(vrows[0].data) : vrows[0].data;
            vipExpiryRT = String(vd.vipExpiry || "");
          }
        } else {
          vipExpiryRT = String(readLocalJsonDb()?.driver_users?.[cleanReporter]?.vipExpiry || "");
        }
        if (!isVipActiveServer(vipExpiryRT)) {
          const todayRT = await countTodayReportTransfers(cleanReporter);
          if (todayRT >= 2) {
            return res.status(403).json({ success: false, error: "\u975EVIP\u4F1A\u5458\u6BCF\u5929\u9650\u8F6C\u53552\u6B21\uFF0C\u660E\u65E96\u70B9\u81EA\u52A8\u6062\u590D\u3002\u5982\u9700\u65E0\u9650\u8F6C\u5355\u8BF7\u5F00\u901AVIP" });
          }
        }
      } catch (e) {
        console.error("[ReportTransfer] VIP\u9650\u989D\u6821\u9A8C\u5F02\u5E38:", e?.message);
      }
      const cleanPassenger = String(passengerPhone || "").replace(/\D/g, "").trim();
      if (!cleanReporter || !/^1[3-9]\d{9}$/.test(cleanPassenger)) {
        return res.status(400).json({ success: false, error: "\u53C2\u6570\u9519\u8BEF" });
      }
      let pLat = Number(pickupLat);
      let pLng = Number(pickupLng);
      const badCoords = isNaN(pLat) || isNaN(pLng) || pLat === 0 || pLng === 0;
      if (badCoords && pickupName) {
        try {
          const poi = await Promise.race([
            geocodeServerPoiAsync(String(pickupName), 0, 0, ""),
            new Promise((resolve) => setTimeout(() => resolve(null), 3e3))
          ]);
          if (poi && poi.lat && poi.lng) {
            pLat = poi.lat;
            pLng = poi.lng;
          }
        } catch (_) {
        }
      }
      const reporterQrUrl = import_fs.default.existsSync(import_path.default.join(process.cwd(), "uploads", "qrcodes", `${cleanReporter}.png`)) ? `/uploads/qrcodes/${cleanReporter}.png` : "";
      const nowTs = Date.now();
      const baseOrder = {
        id: cleanOrderId,
        orderId: cleanOrderId,
        passengerPhone: cleanPassenger,
        startLocation: String(pickupName || ""),
        startDetail: String(pickupDetail || ""),
        destination: "",
        status: "submitted",
        timestamp: nowTs,
        dispatchedAt: nowTs,
        dispatchCountdown: 60,
        serverCountdown: 60,
        dispatchExpiresAt: nowTs + 6e4,
        isValetOrder: true,
        isPlatformDispatch: true,
        orderRemark: "\u62A5\u5355\u8F6C\u5355",
        orderType: "\u62A5\u5355\u8F6C\u5355",
        type: "\u62A5\u5355\u8F6C\u5355",
        passengerLat: pLat,
        passengerLng: pLng,
        lat: pLat,
        lng: pLng,
        startLat: pLat,
        startLng: pLng,
        approxPrice: "\u672A\u77E5",
        scheduledTime: "\u73B0\u5728\u51FA\u53D1",
        needScooter: false,
        merchantPhone: cleanReporter,
        reporterPhone: cleanReporter,
        dispatchedByPhone: cleanReporter,
        dispatchedBy: cleanReporter,
        paymentQrCode: reporterQrUrl,
        merchantPaymentQrCode: reporterQrUrl,
        merchantName: "\u62A5\u5355\u8F6C\u5355"
      };
      const haversineKm = (la1, lo1, la2, lo2) => {
        const R = 6371;
        const dLa = (la2 - la1) * Math.PI / 180;
        const dLo = (lo2 - lo1) * Math.PI / 180;
        const a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      let squadList = [];
      let locationMap = {};
      const dedupeSquadList = (list) => {
        const filtered = list.filter((item) => {
          if (/a$/i.test(String(item.rawId || "").trim())) return false;
          return Boolean(item.phone);
        });
        const seen = /* @__PURE__ */ new Map();
        for (const item of filtered) {
          const cp = String(item.phone || "");
          const prev = seen.get(cp);
          if (!prev) {
            seen.set(cp, item);
            continue;
          }
          const prevValid = isLicenseValid(prev?.data?.licenseExpiry);
          const curValid = isLicenseValid(item?.data?.licenseExpiry);
          if (!prevValid && curValid) seen.set(cp, item);
        }
        return Array.from(seen.values());
      };
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [squadRows] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["squad_members"]
          );
          squadList = dedupeSquadList((squadRows || []).map((r) => {
            const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            const rawId = String(r.doc_id || "");
            return { phone: rawId.replace(/\D/g, "").trim(), rawId, data: d };
          }));
          const [locRows] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["driver_locations"]
          );
          (locRows || []).forEach((r) => {
            const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            const p = String(r.doc_id || d?.phone || "").replace(/\D/g, "").trim();
            if (p) locationMap[p] = d;
          });
        } catch (_) {
        }
      }
      if (squadList.length === 0) {
        try {
          const dbData = readLocalJsonDb();
          const colData = dbData["squad_members"] || {};
          squadList = dedupeSquadList(Object.keys(colData).map((k) => ({
            phone: String(k).replace(/\D/g, "").trim(),
            rawId: String(k),
            data: colData[k]
          })));
          const localLocations = dbData["driver_locations"] || {};
          Object.keys(localLocations).forEach((k) => {
            const p = String(k).replace(/\D/g, "").trim();
            if (p && !locationMap[p]) locationMap[p] = localLocations[k];
          });
        } catch (_) {
        }
      }
      const isApproved = (d) => {
        const st = String(d?.status || d?.approvalStatus || "").trim();
        return ["\u5DF2\u901A\u8FC7", "approved", "\u901A\u8FC7"].includes(st);
      };
      const driverDocMapRt = {};
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [duRowsRt] = await mysqlPool.query(
            "SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?",
            ["driver_users"]
          );
          (duRowsRt || []).forEach((r) => {
            try {
              const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
              const p = String(r.doc_id || d?.phone || "").replace(/\D/g, "").trim();
              if (p) driverDocMapRt[p] = d;
            } catch (_) {
            }
          });
        } catch (_) {
        }
      }
      try {
        const jdbRt = readLocalJsonDb();
        Object.keys(jdbRt["driver_users"] || {}).forEach((k) => {
          const p = String(k).replace(/\D/g, "").trim();
          if (p && !driverDocMapRt[p]) driverDocMapRt[p] = jdbRt["driver_users"][k];
        });
      } catch (_) {
      }
      const removedPhonesArrRt = await readRemovedPhonesMergedUnified();
      const reporterEntry = squadList.find((m) => m.phone === cleanReporter);
      const isReporterApproved = cleanReporter === "15509601222" ? true : !!reporterEntry && isApproved(reporterEntry.data) && !removedPhonesArrRt.includes(cleanReporter);
      if (!isReporterApproved) {
        return res.status(403).json({ success: false, error: "\u4EC5\u5C0F\u961F\u6B63\u5F0F\u6210\u5458\u53EF\u4F7F\u7528\u62A5\u5355\u8F6C\u5355" });
      }
      const pendingMapRt = await getPendingDispatchMap();
      const candidates = [];
      const coordsValid = !isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0;
      if (coordsValid) {
        for (const m of squadList) {
          const phone = m.phone;
          if (!phone || phone === cleanReporter) continue;
          if (!isApproved(m.data)) continue;
          if (phone !== "15509601222" && removedPhonesArrRt.includes(phone)) continue;
          if (!isLicenseValid(resolveExpiryFromDocs(m.data, driverDocMapRt[phone]).licenseExpiry)) continue;
          const loc = locationMap[phone];
          if (!loc) continue;
          const la = Number(loc.lat ?? loc.latitude);
          const lo = Number(loc.lng ?? loc.longitude);
          if (isNaN(la) || isNaN(lo) || la === 0 || lo === 0) continue;
          const updTs = docLatestTimeMs(loc);
          if (!updTs || nowTs - updTs > 12e4) continue;
          const isOnline = loc.isOnline === true || loc.isOnline === "true";
          const isBusy = loc.isBusy === true || loc.isBusy === "true" || loc.isBusy === 1;
          if (!isOnline || isBusy) continue;
          if (occupancyOf(phone, pendingMapRt, loc).occupied) continue;
          const distKm = haversineKm(pLat, pLng, la, lo);
          if (distKm <= 3) candidates.push({ phone, name: m.data?.name || m.data?.driverName || `\u53F8\u673A${phone.slice(-4)}`, distKm });
        }
      }
      candidates.sort((a, b) => a.distKm - b.distKm);
      const writeOrder = async (col, docId, data) => {
        const dataStr = JSON.stringify(data);
        if (isMySQLEnabled && mysqlPool) {
          let ok = false;
          let lastErr = null;
          for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
            try {
              await mysqlPool.query(
                "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
                [col, docId, dataStr]
              );
              ok = true;
            } catch (e) {
              lastErr = e;
              if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
            }
          }
          if (!ok) throw lastErr;
          try {
            const jdb = readLocalJsonDb();
            if (!jdb[col]) jdb[col] = {};
            jdb[col][docId] = data;
            writeLocalJsonDb(jdb);
          } catch (_) {
          }
        } else {
          const dbData = readLocalJsonDb();
          if (!dbData[col]) dbData[col] = {};
          dbData[col][docId] = data;
          writeLocalJsonDb(dbData);
        }
      };
      const deleteLink = async (phone) => {
        if (!phone) return;
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
            ["passenger_links", phone]
          ).catch(() => {
          });
          try {
            const jdb = readLocalJsonDb();
            if (jdb["passenger_links"]?.[phone]) {
              delete jdb["passenger_links"][phone];
              writeLocalJsonDb(jdb);
            }
          } catch (_) {
          }
        } else {
          try {
            const dbData = readLocalJsonDb();
            if (dbData["passenger_links"]?.[phone]) {
              delete dbData["passenger_links"][phone];
              writeLocalJsonDb(dbData);
            }
          } catch (_) {
          }
        }
      };
      if (candidates.length > 0) {
        const chosen = candidates[0];
        const pendRt = await getPendingDispatchForPhone(chosen.phone, true).catch(() => null);
        if (!pendRt || pendRt.orderId === cleanOrderId) {
          const dispatchedPayload = {
            ...baseOrder,
            status: "dispatched",
            statusCategory: "\u5DF2\u6307\u6D3E",
            dispatchedDriverPhone: chosen.phone,
            dispatchedDriverName: chosen.name,
            distKm: chosen.distKm
          };
          await writeOrder("passenger_links", chosen.phone, dispatchedPayload);
          await writeOrder("merchant_orders", cleanOrderId, dispatchedPayload);
          return res.json({
            success: true,
            isHall: false,
            dispatchedDriverPhone: chosen.phone,
            dispatchedDriverName: chosen.name,
            distKm: chosen.distKm
          });
        }
      }
      const hallPayload = {
        ...baseOrder,
        status: "hall",
        statusCategory: "\u7B49\u5F85\u63A5\u5355",
        in_hall: true,
        hallAt: nowTs,
        coordsUnknown: !coordsValid
      };
      await writeOrder("merchant_orders", cleanOrderId, hallPayload);
      return res.json({ success: true, isHall: true });
    } catch (err) {
      console.error("[Report Transfer Dispatch] error:", err);
      res.status(500).json({ success: false, error: err.message || "Report Transfer Dispatch Error" });
    }
  });
  const SQUAD_GATE_CITY_CORE = "\u94F6\u5DDD";
  function squadGateCityCore(s) {
    return String(s || "").trim().replace(/市$/, "");
  }
  async function amapRegeoCity(lng, lat) {
    try {
      const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${AMAP_KEY_SERVER}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(4e3) });
      const data = await resp.json();
      if (data && data.status === "1" && data.regeocode && data.regeocode.addressComponent) {
        const ac = data.regeocode.addressComponent;
        const city = typeof ac.city === "string" && ac.city ? ac.city : typeof ac.province === "string" ? ac.province : "";
        return String(city || "");
      }
    } catch (_) {
    }
    return "";
  }
  async function amapIpCity(ip) {
    try {
      if (!ip || ip === "127.0.0.1" || ip === "::1") return "";
      const url = `https://restapi.amap.com/v3/ip?ip=${encodeURIComponent(ip)}&key=${AMAP_KEY_SERVER}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(3e3) });
      const data = await resp.json();
      if (data && data.status === "1") return String(data.city || "");
    } catch (_) {
    }
    return "";
  }
  function squadGateClientIp(req) {
    const xff = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    return xff || String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  }
  app.post("/api/squad-apply", requireDbAuth, async (req, res) => {
    try {
      const { phone, name, note, city } = req.body || {};
      const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
      const cleanName = String(name || "").trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const rawPhone = String(phone || "").trim();
      if (rawPhone.toUpperCase().endsWith("A")) {
        return res.status(400).json({ success: false, error: "\u5546\u6237\u8D26\u53F7\u514D\u7533\u8BF7\uFF0C\u53EF\u76F4\u63A5\u4F7F\u7528" });
      }
      const tokenPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      if (cleanPhone !== tokenPhone && !req.isAdmin) {
        return res.status(403).json({ success: false, error: "\u53EA\u80FD\u4E3A\u672C\u4EBA\u63D0\u4EA4\u7533\u8BF7" });
      }
      if (!cleanName) {
        return res.status(400).json({ success: false, error: "\u8BF7\u586B\u5199\u771F\u5B9E\u59D3\u540D" });
      }
      let membershipState;
      try {
        membershipState = await getUnifiedMembership(cleanPhone);
      } catch (e) {
        console.error("[Squad Apply] \u72B6\u6001\u68C0\u67E5\u5931\u8D25:", e?.message);
        return res.status(503).json({ success: false, error: "\u72B6\u6001\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      if (membershipState.isMember) {
        return res.status(400).json({ success: false, error: "\u60A8\u5DF2\u662F\u5C0F\u961F\u6210\u5458\uFF0C\u65E0\u9700\u91CD\u590D\u63D0\u4EA4" });
      }
      if (membershipState.phase === "pending") {
        return res.json({ success: true, alreadyPending: true });
      }
      if (membershipState.applicationDoc && isApprovedMemberStatus(membershipState.applicationStatus)) {
        return res.status(409).json({ success: false, error: "\u7533\u8BF7\u72B6\u6001\u5F02\u5E38\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u4EBA\u5458\u5904\u7406" });
      }
      const geo = req.body && typeof req.body.geo === "object" && req.body.geo ? req.body.geo : null;
      const gLat = Number(geo?.lat), gLng = Number(geo?.lng);
      const hasCoords = !!geo && isFinite(gLat) && isFinite(gLng) && gLng >= 70 && gLng <= 140 && gLat >= 15 && gLat <= 55 && geo.mocked !== true;
      let geoCity = "", geoVerified = false;
      if (hasCoords) {
        geoCity = await amapRegeoCity(gLng, gLat);
        if (geoCity) geoVerified = true;
      }
      let ipCity = "";
      try {
        ipCity = await amapIpCity(squadGateClientIp(req));
      } catch (_) {
      }
      const ipMismatch = !!(geoVerified && ipCity && squadGateCityCore(ipCity) !== squadGateCityCore(geoCity));
      if (geoVerified) {
        if (squadGateCityCore(geoCity) !== SQUAD_GATE_CITY_CORE) {
          return res.status(400).json({ success: false, error: `\u4F60\u5F53\u524D\u6240\u5728\u57CE\u5E02\u4E3A${geoCity}\uFF0C\u8BE5\u57CE\u5E02\u6682\u672A\u5F00\u901A\u5C0F\u961F\uFF0C\u65E0\u6CD5\u63D0\u4EA4\u7533\u8BF7` });
        }
      } else if (geo && geo.unavailable === true && !hasCoords) {
        return res.status(400).json({ success: false, error: "\u672A\u83B7\u53D6\u5230\u4F60\u7684\u5B9A\u4F4D\uFF0C\u8BF7\u5F00\u542F\u5B9A\u4F4D\u6743\u9650\u5E76\u5230\u5BA4\u5916\u7A7A\u65F7\u5904\u540E\u91CD\u8BD5" });
      } else {
        const declaredCore = squadGateCityCore(String(city || "\u94F6\u5DDD\u5E02"));
        if (declaredCore !== SQUAD_GATE_CITY_CORE) {
          return res.status(400).json({ success: false, error: `\u4F60\u586B\u5199\u7684\u57CE\u5E02\u4E3A${String(city || "").slice(0, 20)}\uFF0C\u94F6\u5DDD\u5C0F\u961F\u4EC5\u63A5\u6536\u94F6\u5DDD\u5E02\u7684\u5165\u961F\u7533\u8BF7` });
        }
      }
      const appPayload = {
        id: cleanPhone,
        // 2026-10-22 第六轮(P0-1)：内嵌 id 必须等于文档键手机号（旧 'app-<时间戳>' 会被 db/list 过滤器误当身份，导致新申请在所有列表不可见）
        name: cleanName,
        phone: cleanPhone,
        status: "\u5F85\u5BA1\u6838",
        note: String(note || "").slice(0, 200),
        city: String(city || "\u94F6\u5DDD\u5E02").slice(0, 20),
        // 城市闸门留痕（2026-11-23）：反查城市/是否坐标核验/IP城市与不一致标记，供管理核对
        geoCity,
        geoVerified,
        ipCity,
        ipMismatch,
        applyLat: hasCoords ? Math.round(gLat * 1e5) / 1e5 : null,
        applyLng: hasCoords ? Math.round(gLng * 1e5) / 1e5 : null,
        createdAt: (/* @__PURE__ */ new Date()).toLocaleString(),
        timestamp: Date.now(),
        approvedBy: "",
        approvedRole: "",
        approvalTime: ""
      };
      const dataStr = JSON.stringify(appPayload);
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["squad_applications", cleanPhone, dataStr]
        );
        try {
          const dbData = readLocalJsonDb();
          if (!dbData.squad_applications) dbData.squad_applications = {};
          dbData.squad_applications[cleanPhone] = appPayload;
          writeLocalJsonDb(dbData);
        } catch (_) {
        }
      } else {
        const dbData = readLocalJsonDb();
        if (!dbData.squad_applications) dbData.squad_applications = {};
        dbData.squad_applications[cleanPhone] = appPayload;
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Squad Apply] error:", err);
      res.status(500).json({ success: false, error: err.message || "Squad Apply Error" });
    }
  });
  app.post("/api/squad-apply/withdraw", requireDbAuth, async (req, res) => {
    try {
      const { phone } = req.body || {};
      const cleanPhone = String(phone || req.authPhone || "").replace(/\D/g, "").trim();
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const requesterPhone = String(req.authPhone || "").replace(/\D/g, "").trim();
      if (cleanPhone !== requesterPhone && !req.isAdmin && !req.isManager && !req.isDispatcher) {
        return res.status(403).json({ success: false, error: "\u65E0\u6743\u64A4\u56DE\u4ED6\u4EBA\u7533\u8BF7\uFF08\u4EC5\u672C\u4EBA\u6216\u7BA1\u7406\u5C42\u53EF\u64CD\u4F5C\uFF09" });
      }
      const isProxyWithdraw = cleanPhone !== requesterPhone;
      let state;
      try {
        state = await getUnifiedMembership(cleanPhone);
      } catch (e) {
        console.error("[Squad Withdraw] \u72B6\u6001\u68C0\u67E5\u5931\u8D25:", e?.message);
        return res.status(503).json({ success: false, error: "\u72B6\u6001\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" });
      }
      if (state.isMember) {
        return res.status(409).json({ success: false, error: "\u5DF2\u662F\u5C0F\u961F\u6210\u5458\uFF0C\u65E0\u9700\u64A4\u56DE" });
      }
      if (!state.applicationDoc) {
        return res.status(404).json({ success: false, error: "\u7533\u8BF7\u4E0D\u5B58\u5728" });
      }
      if (!["\u5F85\u5BA1\u6838", "pending", "\u5BA1\u6838\u4E2D", "\u5DF2\u62D2\u7EDD"].includes(state.applicationStatus)) {
        return res.status(409).json({ success: false, error: "\u5F53\u524D\u7533\u8BF7\u72B6\u6001\u4E0D\u53EF\u64A4\u56DE" });
      }
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          "DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?",
          ["squad_applications", cleanPhone]
        );
      }
      syncLocalWithdraw(cleanPhone);
      if (isProxyWithdraw) {
        await logAdminOperation("withdraw-application", requesterPhone, cleanPhone, `\u7BA1\u7406\u5C42\u4EE3\u64A4\u56DE ${cleanPhone} \u7684\u5165\u961F\u7533\u8BF7`, req);
      }
      return res.json({ success: true, withdrawn: true });
    } catch (err) {
      console.error("[Squad Withdraw] error:", err);
      res.status(500).json({ success: false, error: err.message || "Withdraw Error" });
    }
  });
  const qrsDir = import_path.default.join(process.cwd(), "uploads", "qrs");
  const qrcodesDir = import_path.default.join(process.cwd(), "uploads", "qrcodes");
  if (!import_fs.default.existsSync(qrsDir)) {
    import_fs.default.mkdirSync(qrsDir, { recursive: true });
  }
  if (!import_fs.default.existsSync(qrcodesDir)) {
    import_fs.default.mkdirSync(qrcodesDir, { recursive: true });
  }
  const qrRelationCache = /* @__PURE__ */ new Map();
  const QR_RELATION_TTL_MS = 10 * 60 * 1e3;
  const hasQrOrderRelation = async (requesterDigits, filePhoneRaw) => {
    const fileDigits = String(filePhoneRaw || "").replace(/\D/g, "");
    if (!requesterDigits || !fileDigits || requesterDigits === fileDigits) return false;
    const cacheKey = `${requesterDigits}|${fileDigits}`;
    const hit = qrRelationCache.get(cacheKey);
    if (hit && Date.now() - hit.at < QR_RELATION_TTL_MS) return hit.ok;
    let ok = false;
    const orderLinksPair = (order) => {
      if (!order || typeof order !== "object") return false;
      const orderer = String(order.merchantPhone || order.creatorPhone || order.reporterPhone || order.dispatchedByPhone || order.adminPhone || order.dispatcherPhone || "").replace(/\D/g, "");
      const driver = String(order.dispatchedDriverPhone || order.claimedDriverPhone || order.driverPhone || "").replace(/\D/g, "");
      return orderer === fileDigits && driver === requesterDigits;
    };
    try {
      if (isMySQLEnabled && mysqlPool) {
        for (const col of ["merchant_orders", "valet_orders"]) {
          if (ok) break;
          try {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ?",
              [col]
            );
            for (const r of rows || []) {
              const d = typeof r.data === "string" ? parseStoredDoc(r.data) : r.data;
              if (orderLinksPair(d)) {
                ok = true;
                break;
              }
            }
          } catch (_) {
          }
        }
      }
      if (!ok) {
        const dbData = readLocalJsonDb();
        for (const col of ["merchant_orders", "valet_orders"]) {
          if (ok) break;
          const docs = dbData[col] || {};
          for (const d of Object.values(docs)) {
            if (orderLinksPair(d)) {
              ok = true;
              break;
            }
          }
        }
      }
    } catch (_) {
    }
    qrRelationCache.set(cacheKey, { ok, at: Date.now() });
    return ok;
  };
  const qrStaticGuard = async (req, res, next) => {
    const requester = String(req.authPhone || "").replace(/\D/g, "").trim();
    const filename = String(req.path || "").split("/").pop() || "";
    const m = filename.match(/^(\d{11}A?)(?:_(?:web|app))?\.png$/i);
    if (!m) return res.status(404).json({ success: false, error: "Not found" });
    const filePhone = m[1].toUpperCase();
    const reqNorm = requester.toUpperCase();
    const reqRaw = String(req.authPhone || "").trim().toUpperCase();
    if (req.isAdmin || filePhone === reqRaw || filePhone === reqRaw.replace(/A$/, "") || filePhone === reqNorm) {
      return next();
    }
    try {
      if (await hasQrOrderRelation(requester, filePhone)) return next();
    } catch (_) {
    }
    return res.status(403).json({ success: false, error: "\u65E0\u6743\u8BBF\u95EE\u4ED6\u4EBA\u6536\u6B3E\u7801" });
  };
  app.use("/uploads/qrcodes", requireDbAuth, qrStaticGuard);
  app.use("/uploads/qrs", requireDbAuth, qrStaticGuard);
  app.use("/uploads", import_express.default.static(import_path.default.join(process.cwd(), "uploads")));
  app.use(["/uploads/qrcodes", "/uploads/qrs"], (req, res) => {
    return res.status(404).json({ success: false, error: "Not found" });
  });
  app.use(async (req, res, next) => {
    const p = String(req.path || "");
    if (/^\/server\.cjs(\.map)?$/i.test(p)) {
      return res.status(403).json({ success: false, error: "\u7981\u6B62\u8BBF\u95EE" });
    }
    if (/^\/(daijia_deploy|baota_deploy|deploy)\.(zip|tar\.gz|tar)$/i.test(p)) {
      if (await verifyDeveloperDownload(req)) return next();
      return res.status(403).json({ success: false, error: "\u90E8\u7F72\u5305\u4E0B\u8F7D\u9700\u8981\u5F00\u53D1\u8005\u767B\u5F55" });
    }
    next();
  });
  app.use(import_express.default.static(import_path.default.join(process.cwd(), "public")));
  app.post("/api/upload-wechat-qr", requireDbAuth, async (req, res) => {
    try {
      const { phone, imageBase64, channel } = req.body;
      if (!phone || !imageBase64) {
        return res.status(400).json({ error: "Missing phone or imageBase64" });
      }
      const rawPhone = String(phone).trim().toUpperCase();
      const authPhone = String(req.authPhone || "").trim().toUpperCase();
      if (!req.isAdmin && rawPhone !== authPhone) {
        return res.status(403).json({ error: "\u65E0\u6743\u4E0A\u4F20\u4ED6\u4EBA\u4E8C\u7EF4\u7801" });
      }
      const cleanPhone = rawPhone.replace(/\D/g, "").trim();
      if (!cleanPhone || cleanPhone.length !== 11) {
        return res.status(400).json({ error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "\u56FE\u7247\u592A\u5927\uFF0C\u8BF7\u538B\u7F29\u540E\u4E0A\u4F20" });
      }
      const isRealImage = buffer.length > 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71 || // PNG
      buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 || // JPEG
      buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" || // WebP
      buffer.length > 6 && buffer.toString("ascii", 0, 4) === "GIF8";
      if (!isRealImage) {
        return res.status(400).json({ error: "\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u56FE\u7247\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u6536\u6B3E\u7801\u56FE\u7247" });
      }
      const isWeb = channel === "web" || channel === "mobile_web" || rawPhone.endsWith("A");
      const filePhone = rawPhone.endsWith("A") ? `${cleanPhone}A` : cleanPhone;
      const filename = isWeb ? `${filePhone}_web.png` : `${filePhone}.png`;
      const filepath = import_path.default.join(qrcodesDir, filename);
      await import_fs.default.promises.writeFile(filepath, buffer);
      if (!isWeb) {
        try {
          const appFilepath = import_path.default.join(qrcodesDir, `${filePhone}_app.png`);
          await import_fs.default.promises.writeFile(appFilepath, buffer);
        } catch (_) {
        }
      }
      const qrUrl = `/uploads/qrcodes/${filename}?t=${Date.now()}`;
      const targetCols = isWeb ? ["web_valet_qrs", "dispatch_qrs_web", "merchant_users"] : ["app_valet_qrs", "dispatch_qrs", "dispatch_qrcodes", "driver_users"];
      const qrPayload = {
        // P0-5: doc_id保留A后缀，账号隔离
        id: filePhone,
        phone: filePhone,
        qrCode: qrUrl,
        wechatQrCode: qrUrl,
        qrcode_url: `/uploads/qrcodes/${filename}`,
        channel: isWeb ? "web" : "app",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      for (const col of targetCols) {
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, filePhone]
            );
            let merged = { ...qrPayload };
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
              merged = { ...prev, ...qrPayload };
            }
            await mysqlPool.query(
              "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
              [col, filePhone, JSON.stringify(merged)]
            );
          } catch (_) {
          }
        }
      }
      try {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][filePhone] = { ...dbData[col][filePhone] || {}, ...qrPayload };
        }
        writeLocalJsonDb(dbData);
      } catch (_) {
      }
      res.json({ success: true, url: qrUrl, channel: isWeb ? "web" : "app" });
    } catch (err) {
      console.error("[Server] Failed to upload WeChat QR:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  });
  app.post("/api/upload-alipay-qr", (req, res) => {
    return res.status(410).json({
      success: false,
      error: "\u8BE5\u63A5\u53E3\u5DF2\u4E0B\u7EBF\uFF1A\u652F\u4ED8\u5B9D\u6536\u6B3E\u7801\u53EA\u5B58App\u672C\u5730\uFF0C\u7EDD\u4E0D\u4E0A\u4F20\u670D\u52A1\u5668"
    });
  });
  app.get("/api/get-wechat-qr", requireDbAuth, async (req, res) => {
    try {
      const requester = String(req.authPhone || "").replace(/\D/g, "");
      const queryPhone = String(req.query.phone || "").replace(/\D/g, "");
      const orderId = String(req.query.orderId || "").trim();
      const isDev = req.isAdmin;
      let authorized = isDev || queryPhone === requester;
      if (!authorized && orderId) {
        const checkOrderAuth = (order) => {
          if (!order) return false;
          const ordererPhone = String(order.merchantPhone || order.driverPhone || order.ordererPhone || "").replace(/\D/g, "");
          const assignedDriver = String(order.dispatchedDriverPhone || order.claimedDriverPhone || "").replace(/\D/g, "");
          return queryPhone === ordererPhone && (requester === assignedDriver || requester === ordererPhone);
        };
        try {
          if (isMySQLEnabled && mysqlPool) {
            for (const col of ["merchant_orders", "valet_orders"]) {
              try {
                const [rows] = await mysqlPool.query(
                  "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                  [col, orderId]
                );
                if (rows && rows.length > 0) {
                  const data = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
                  if (checkOrderAuth(data)) {
                    authorized = true;
                    break;
                  }
                }
              } catch (_) {
              }
            }
          }
          if (!authorized) {
            const dbData = readLocalJsonDb();
            const order = dbData.merchant_orders?.[orderId] || dbData.valet_orders?.[orderId];
            if (checkOrderAuth(order)) authorized = true;
          }
        } catch (_) {
        }
      }
      if (!authorized) {
        return res.status(403).json({ success: false, error: "\u65E0\u6743\u67E5\u8BE2\u8BE5\u6536\u6B3E\u7801" });
      }
      const clientIp = getClientIp(req);
      const now = Date.now();
      const qrKey = `qr:${clientIp}`;
      const qrLogs = (smsSendLogs.get(qrKey) || []).filter((t) => now - t < 60 * 1e3);
      if (qrLogs.length >= 240) {
        return res.status(429).json({ success: false, error: "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" });
      }
      qrLogs.push(now);
      smsSendLogs.set(qrKey, qrLogs);
      const rawPhoneQ = String(req.query.phone || "").trim().toUpperCase();
      const phoneDigits = rawPhoneQ.replace(/\D/g, "").trim();
      const channel = String(req.query.channel || "").trim();
      if (!phoneDigits) {
        return res.status(400).json({ success: false, error: "Missing phone" });
      }
      const phone = rawPhoneQ.endsWith("A") ? `${phoneDigits}A` : phoneDigits;
      const isWeb = channel === "web" || channel === "mobile_web" || phone.endsWith("A");
      const webFilename = `${phone}_web.png`;
      const appFilename = `${phone}.png`;
      const appSpecificFilename = `${phone}_app.png`;
      if (isWeb) {
        if (import_fs.default.existsSync(import_path.default.join(qrcodesDir, webFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrcodesDir, webFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${webFilename}?t=${stat.mtimeMs}`, channel: "web" });
        }
        if (import_fs.default.existsSync(import_path.default.join(qrsDir, webFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrsDir, webFilename));
          return res.json({ success: true, url: `/uploads/qrs/${webFilename}?t=${stat.mtimeMs}`, channel: "web" });
        }
        if (import_fs.default.existsSync(import_path.default.join(qrcodesDir, appFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrcodesDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appFilename}?t=${stat.mtimeMs}`, channel: "web" });
        }
        if (import_fs.default.existsSync(import_path.default.join(qrsDir, appFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrsDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: "web" });
        }
      } else {
        if (import_fs.default.existsSync(import_path.default.join(qrcodesDir, appSpecificFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrcodesDir, appSpecificFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appSpecificFilename}?t=${stat.mtimeMs}`, channel: "app" });
        }
        if (import_fs.default.existsSync(import_path.default.join(qrcodesDir, appFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrcodesDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appFilename}?t=${stat.mtimeMs}`, channel: "app" });
        }
        if (import_fs.default.existsSync(import_path.default.join(qrsDir, appSpecificFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrsDir, appSpecificFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appSpecificFilename}?t=${stat.mtimeMs}`, channel: "app" });
        }
        if (import_fs.default.existsSync(import_path.default.join(qrsDir, appFilename))) {
          const stat = import_fs.default.statSync(import_path.default.join(qrsDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: "app" });
        }
      }
      const targetCols = isWeb ? ["web_valet_qrs", "dispatch_qrs_web", "merchant_users", "dispatch_qrs", "dispatch_qrcodes", "driver_users"] : ["app_valet_qrs", "driver_users", "dispatch_qrs", "dispatch_qrcodes", "web_valet_qrs", "merchant_users"];
      if (isMySQLEnabled && mysqlPool) {
        for (const col of targetCols) {
          try {
            const [rows] = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
              [col, phone]
            );
            if (rows && rows.length > 0) {
              const rowData = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
              const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
              if (foundQr && typeof foundQr === "string" && foundQr.trim()) {
                const pth = foundQr.trim().split("?")[0];
                if (pth.startsWith("/uploads/") && !import_fs.default.existsSync(import_path.default.join(process.cwd(), pth))) {
                  continue;
                }
                return res.json({ success: true, url: foundQr, channel: isWeb ? "web" : "app" });
              }
            }
          } catch (_) {
          }
        }
      }
      if (!isMySQLEnabled || !mysqlPool) {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (dbData[col] && dbData[col][phone]) {
            const rowData = dbData[col][phone];
            const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
            if (foundQr && typeof foundQr === "string" && foundQr.trim()) {
              const pth = foundQr.trim().split("?")[0];
              if (pth.startsWith("/uploads/") && !import_fs.default.existsSync(import_path.default.join(process.cwd(), pth))) {
                continue;
              }
              return res.json({ success: true, url: foundQr, channel: isWeb ? "web" : "app" });
            }
          }
        }
      }
      if (import_fs.default.existsSync(import_path.default.join(qrsDir, appFilename))) {
        const stat = import_fs.default.statSync(import_path.default.join(qrsDir, appFilename));
        return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: "fallback" });
      }
      try {
        const altPhone = phone.endsWith("A") ? phoneDigits : `${phoneDigits}A`;
        const altIsWeb = !isWeb;
        const altWebFile = `${altPhone}_web.png`;
        const altAppFile = `${altPhone}.png`;
        const altAppSpecific = `${altPhone}_app.png`;
        const altCandidates = altIsWeb ? [[qrcodesDir, altWebFile], [qrsDir, altWebFile], [qrcodesDir, altAppFile], [qrsDir, altAppFile]] : [[qrcodesDir, altAppSpecific], [qrcodesDir, altAppFile], [qrsDir, altAppSpecific], [qrsDir, altAppFile]];
        for (const [dir, fn] of altCandidates) {
          const fp = import_path.default.join(dir, fn);
          if (import_fs.default.existsSync(fp)) {
            const stat = import_fs.default.statSync(fp);
            const dirName = dir === qrsDir ? "qrs" : "qrcodes";
            return res.json({ success: true, url: `/uploads/${dirName}/${fn}?t=${stat.mtimeMs}`, channel: altIsWeb ? "web" : "app" });
          }
        }
        const altCols = altIsWeb ? ["web_valet_qrs", "dispatch_qrs_web", "merchant_users", "dispatch_qrs", "dispatch_qrcodes", "driver_users"] : ["app_valet_qrs", "driver_users", "dispatch_qrs", "dispatch_qrcodes", "web_valet_qrs", "merchant_users"];
        if (isMySQLEnabled && mysqlPool) {
          for (const col of altCols) {
            try {
              const [rows] = await mysqlPool.query(
                "SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1",
                [col, altPhone]
              );
              if (rows && rows.length > 0) {
                const rowData = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
                const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
                if (foundQr && typeof foundQr === "string" && foundQr.trim()) {
                  const pth = foundQr.trim().split("?")[0];
                  if (pth.startsWith("/uploads/") && !import_fs.default.existsSync(import_path.default.join(process.cwd(), pth))) {
                    continue;
                  }
                  return res.json({ success: true, url: foundQr, channel: altIsWeb ? "web" : "app" });
                }
              }
            } catch (_) {
            }
          }
        }
        if (!isMySQLEnabled || !mysqlPool) {
          const dbDataAlt = readLocalJsonDb();
          for (const col of altCols) {
            const rowData = dbDataAlt[col]?.[altPhone];
            const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
            if (foundQr && typeof foundQr === "string" && foundQr.trim()) {
              const pth = foundQr.trim().split("?")[0];
              if (pth.startsWith("/uploads/") && !import_fs.default.existsSync(import_path.default.join(process.cwd(), pth))) {
                continue;
              }
              return res.json({ success: true, url: foundQr, channel: altIsWeb ? "web" : "app" });
            }
          }
        }
      } catch (_) {
      }
      return res.json({ success: false, url: "", message: "QR not found" });
    } catch (err) {
      console.error("[Server get-wechat-qr error]:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/delete-wechat-qr", requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.userPhone || "").trim();
      if (!phone) {
        return res.status(400).json({ error: "Missing phone" });
      }
      const rawPhone = phone.toUpperCase();
      const authPhone = String(req.authPhone || "").trim().toUpperCase();
      if (!req.isAdmin && rawPhone !== authPhone) {
        return res.status(403).json({ error: "\u65E0\u6743\u5220\u9664\u4ED6\u4EBA\u4E8C\u7EF4\u7801" });
      }
      const cleanPhone = rawPhone.replace(/\D/g, "").trim();
      if (!cleanPhone || cleanPhone.length !== 11) {
        return res.status(400).json({ error: "\u624B\u673A\u53F7\u683C\u5F0F\u9519\u8BEF" });
      }
      const filePhone = rawPhone.endsWith("A") ? `${cleanPhone}A` : cleanPhone;
      const allowedFiles = /* @__PURE__ */ new Set([`${filePhone}.png`, `${filePhone}_web.png`, `${filePhone}_app.png`]);
      [qrcodesDir, qrsDir].forEach((dir) => {
        if (import_fs.default.existsSync(dir)) {
          try {
            const files = import_fs.default.readdirSync(dir);
            files.forEach((f) => {
              if (allowedFiles.has(f)) {
                try {
                  import_fs.default.unlinkSync(import_path.default.join(dir, f));
                } catch (_) {
                }
              }
            });
          } catch (_) {
          }
        }
      });
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query("DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?", ["dispatch_qrs", filePhone]);
          await mysqlPool.query("DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?", ["dispatch_qrcodes", filePhone]);
          for (const wcol of ["web_valet_qrs", "dispatch_qrs_web", "app_valet_qrs"]) {
            await mysqlPool.query("DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?", [wcol, filePhone]).catch(() => {
            });
          }
          const [muRows] = await mysqlPool.query("SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1", ["merchant_users", filePhone]).catch(() => [[]]);
          if (muRows && muRows.length > 0) {
            const muPrev = typeof muRows[0].data === "string" ? JSON.parse(muRows[0].data) : muRows[0].data;
            muPrev.wechatQrCode = "";
            muPrev.qrCode = "";
            muPrev.qrcode_url = "";
            muPrev.wechatClean = "";
            await mysqlPool.query("INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)", ["merchant_users", filePhone, JSON.stringify(muPrev)]);
          }
          const [rows] = await mysqlPool.query("SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1", ["driver_users", phone]);
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
            prev.wechatQrCode = "";
            prev.qrCode = "";
            prev.qrcode_url = "";
            prev.wechatClean = "";
            await mysqlPool.query("INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)", ["driver_users", phone, JSON.stringify(prev)]);
          }
          const [squadRows] = await mysqlPool.query("SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1", ["squad_members", phone]);
          if (squadRows && squadRows.length > 0) {
            const squadPrev = typeof squadRows[0].data === "string" ? JSON.parse(squadRows[0].data) : squadRows[0].data;
            squadPrev.wechatQrCode = "";
            squadPrev.qrCode = "";
            squadPrev.qrcode_url = "";
            squadPrev.wechatClean = "";
            await mysqlPool.query("INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)", ["squad_members", phone, JSON.stringify(squadPrev)]);
          }
        } catch (err) {
          console.error("[MySQL delete-wechat-qr error]:", err);
        }
      }
      const dbData = readLocalJsonDb();
      if (dbData.dispatch_qrs && dbData.dispatch_qrs[phone]) delete dbData.dispatch_qrs[phone];
      if (dbData.dispatch_qrcodes && dbData.dispatch_qrcodes[phone]) delete dbData.dispatch_qrcodes[phone];
      for (const wcol of ["web_valet_qrs", "dispatch_qrs_web", "app_valet_qrs"]) {
        if (dbData[wcol] && dbData[wcol][filePhone]) delete dbData[wcol][filePhone];
      }
      if (dbData.merchant_users && dbData.merchant_users[filePhone]) {
        dbData.merchant_users[filePhone].wechatQrCode = "";
        dbData.merchant_users[filePhone].qrCode = "";
        dbData.merchant_users[filePhone].qrcode_url = "";
      }
      if (dbData.driver_users && dbData.driver_users[phone]) {
        dbData.driver_users[phone].wechatQrCode = "";
        dbData.driver_users[phone].qrCode = "";
        dbData.driver_users[phone].qrcode_url = "";
      }
      if (dbData.squad_members && dbData.squad_members[phone]) {
        dbData.squad_members[phone].wechatQrCode = "";
        dbData.squad_members[phone].qrCode = "";
        dbData.squad_members[phone].qrcode_url = "";
      }
      if (dbData.online_applications && dbData.online_applications[phone]) {
        dbData.online_applications[phone].wechatQrCode = "";
        dbData.online_applications[phone].qrCode = "";
        dbData.online_applications[phone].qrcode_url = "";
      }
      if (dbData.squad_applications && dbData.squad_applications[phone]) {
        dbData.squad_applications[phone].wechatQrCode = "";
        dbData.squad_applications[phone].qrCode = "";
        dbData.squad_applications[phone].qrcode_url = "";
      }
      writeLocalJsonDb(dbData);
      console.log(`\u2713 [Server] Deleted QR code for phone: ${phone}`);
      res.json({ success: true, message: "QR code deleted successfully" });
    } catch (err) {
      console.error("[Server] Failed to delete QR:", err);
      res.status(500).json({ error: "Delete failed" });
    }
  });
  app.get("/passenger_order.html", (req, res) => {
    res.sendFile(import_path.default.join(process.cwd(), "passenger_order.html"));
  });
  app.get("/vip", (req, res) => {
    res.sendFile(import_path.default.join(process.cwd(), "vip_buy.html"));
  });
  app.get("/pay", (req, res) => {
    res.sendFile(import_path.default.join(process.cwd(), "vip_pay.html"));
  });
  app.get("/topup", (req, res) => {
    res.sendFile(import_path.default.join(process.cwd(), "wallet_recharge.html"));
  });
  app.get("/aliyun_passenger_deploy.html", (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(302, "/passenger_order.html" + qs);
  });
  const verifyDeveloperDownload = async (req) => {
    try {
      const token = String(req?.headers?.["x-auth-token"] || "").trim();
      if (!token) return false;
      const persistent = await verifyPersistentToken(token).catch(() => null);
      const phone = String(persistent?.phone || authTokens.get(token)?.phone || "").replace(/\D/g, "").trim();
      return phone === DEVELOPER_PHONE_SERVER;
    } catch (_) {
      return false;
    }
  };
  const servePackageFile = async (req, res, requestedName = "daijia_deploy.zip") => {
    if (!await verifyDeveloperDownload(req)) {
      return res.status(403).json({ success: false, error: "\u90E8\u7F72\u5305\u4E0B\u8F7D\u9700\u8981\u5F00\u53D1\u8005\u767B\u5F55" });
    }
    const candidatePaths = [
      import_path.default.join(process.cwd(), "public", requestedName),
      import_path.default.join(process.cwd(), requestedName),
      import_path.default.join(process.cwd(), "dist", requestedName),
      import_path.default.join(process.cwd(), "public", "daijia_deploy.zip"),
      import_path.default.join(process.cwd(), "daijia_deploy.zip"),
      import_path.default.join(process.cwd(), "dist", "daijia_deploy.zip")
    ];
    let targetPath = candidatePaths.find((p) => import_fs.default.existsSync(p) && import_fs.default.statSync(p).size > 1e6);
    if (!targetPath) {
      try {
        console.log(`[Package Service] File ${requestedName} missing or invalid, running create_deploy_zip.py...`);
        (0, import_child_process.execSync)("python3 create_deploy_zip.py", { cwd: process.cwd() });
        targetPath = candidatePaths.find((p) => import_fs.default.existsSync(p) && import_fs.default.statSync(p).size > 1e6);
      } catch (e) {
        console.error("Build package failed:", e);
      }
    }
    if (targetPath && import_fs.default.existsSync(targetPath)) {
      const stat = import_fs.default.statSync(targetPath);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${requestedName}"`);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Transfer-Encoding", "binary");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      const fileStream = import_fs.default.createReadStream(targetPath);
      fileStream.pipe(res);
      fileStream.on("error", (err) => {
        console.error("[Package Service] Stream pipe error:", err);
        if (!res.headersSent) {
          res.status(500).send("Download stream failed");
        }
      });
    } else {
      res.status(500).json({ error: "Package file build failed" });
    }
  };
  app.get("/daijia_deploy.zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/baota_deploy.zip", (req, res) => servePackageFile(req, res, "baota_deploy.zip"));
  app.get("/deploy.zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/api/download-zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/api/download/zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/daijia_deploy.tar.gz", (req, res) => servePackageFile(req, res, "daijia_deploy.tar.gz"));
  app.get("/baota_deploy.tar.gz", (req, res) => servePackageFile(req, res, "daijia_deploy.tar.gz"));
  app.get("/daijia_deploy.tar", (req, res) => servePackageFile(req, res, "daijia_deploy.tar"));
  app.get("/baota_deploy.tar", (req, res) => servePackageFile(req, res, "daijia_deploy.tar"));
  if (process.env.NODE_ENV === "development") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware loaded.");
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    const indexHtmlPath = import_path.default.join(distPath, "index.html");
    if (import_fs.default.existsSync(distPath)) {
      app.use(import_express.default.static(distPath));
    }
    app.get("*", (req, res) => {
      if (import_fs.default.existsSync(indexHtmlPath)) {
        res.sendFile(indexHtmlPath);
      } else {
        res.status(404).send("Application build in progress or index.html not found");
      }
    });
    console.log("Static production build files configured from:", distPath);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\u{1F680} Dedicated Full-Stack proxy server boot successfully on port: http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("FATAL: Failed to boot Express Server:", err);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUTHORITATIVE_REAL_DRIVER_NAMES
});
//# sourceMappingURL=server.cjs.map
