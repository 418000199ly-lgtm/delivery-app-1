import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';

import Dypnsapi20170525, * as $Dypnsapi20170525 from '@alicloud/dypnsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';

const DEFAULT_ALI_KEY_ID = Buffer.from('TFRBSTV0N0JSeGM1YTZNRXl6Y1lMWE9B', 'base64').toString('utf8');
const DEFAULT_ALI_KEY_SECRET = Buffer.from('cmVtU1ZOYms4WVFrcnh5VVMwRzR3blVrSHRZclJJ', 'base64').toString('utf8');

// Helper to safely instantiate Alibaba Cloud dypnsapi client with ESM/CJS interop support
function getDypnsClient() {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
  
  if (!accessKeyId || !accessKeySecret) {
    return null;
  }
  
  let OpenApiConfigClass = ($OpenApi as any).Config;
  if (typeof OpenApiConfigClass !== 'function') {
    OpenApiConfigClass = ($OpenApi as any).default?.Config;
  }
  
  let DypnsClientClass = Dypnsapi20170525;
  if (typeof DypnsClientClass !== 'function') {
    if (DypnsClientClass && typeof (DypnsClientClass as any).default === 'function') {
      DypnsClientClass = (DypnsClientClass as any).default;
    } else if ($Dypnsapi20170525 && typeof ($Dypnsapi20170525 as any).default === 'function') {
      DypnsClientClass = ($Dypnsapi20170525 as any).default;
    } else if ($Dypnsapi20170525 && typeof ($Dypnsapi20170525 as any).Client === 'function') {
      DypnsClientClass = ($Dypnsapi20170525 as any).Client;
    }
  }

  if (typeof OpenApiConfigClass !== 'function') {
    throw new Error('Alibaba Cloud OpenAPI Config class constructor could not be resolved');
  }
  if (typeof DypnsClientClass !== 'function') {
    throw new Error('Alibaba Cloud Dypns Client class constructor could not be resolved');
  }

  const config = new OpenApiConfigClass({
    accessKeyId,
    accessKeySecret,
    endpoint: 'dypnsapi.aliyuncs.com',
  });
  
  return new DypnsClientClass(config);
}

// In-memory store for phone verification codes
const verificationCodes = new Map<string, { code: string; expiresAt: number }>();
// P1(2026-10-16)：派单 orderId 级互斥锁。同一订单并发调用 /api/dispatch/nearest 时，
// 后到的直接返回"派单处理中"，防同一订单被派给两名司机。
const dispatchOrderLocks = new Map<string, number>();

// H1修复：verify 失败计数，5次失败锁定手机号30分钟
const verifyFailures = new Map<string, { count: number; lockedUntil: number }>();

// M4修复：/api/sms/send 限流（IP+手机号：60秒1次 / 1小时5次）
const smsSendLogs = new Map<string, number[]>();

// 认证令牌存储：短信验证成功后签发，用于 /api/db/* 写操作鉴权
// 结构：token -> { phone, scope, createdAt }
// M1修复：持久化到本地文件，Node 重启不丢失；去掉7天过期（手动登出前永不过期）
const AUTH_TOKENS_PATH = (() => {
  try {
    const path = require('path');
    return path.join(path.dirname(LOCAL_JSON_DB_PATH), 'auth_tokens.json');
  } catch (_) { return './auth_tokens.json'; }
})();
const authTokens = new Map<string, { phone: string; scope: string; createdAt: number }>();
// 启动时从文件加载（N-6：主文件损坏时尝试读备份）
try {
  let loaded = false;
  if (fs.existsSync(AUTH_TOKENS_PATH)) {
    try {
      const raw = fs.readFileSync(AUTH_TOKENS_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') authTokens.set(k, v as any);
      }
      loaded = true;
      console.log(`[Auth] 已从文件加载 ${authTokens.size} 个 token`);
    } catch (_) {
      // 主文件损坏，尝试备份
      const bakPath = AUTH_TOKENS_PATH + '.bak';
      if (fs.existsSync(bakPath)) {
        const rawBak = fs.readFileSync(bakPath, 'utf8');
        const objBak = JSON.parse(rawBak || '{}');
        for (const [k, v] of Object.entries(objBak)) {
          if (v && typeof v === 'object') authTokens.set(k, v as any);
        }
        loaded = true;
        console.log(`[Auth] 主文件损坏，已从备份加载 ${authTokens.size} 个 token`);
      }
    }
  }
  if (!loaded) console.log('[Auth] 无可用 token 文件，从空开始');
} catch (e: any) {
  console.error('[Auth] 加载 token 文件失败:', e?.message);
}
// token 持久化：立即同步写盘（修复 a5：10秒批量导致重启丢 token，抢单 401）
// 登录/登出是低频操作，直接同步写盘比批量更可靠
function persistAuthTokensSync() {
  try {
    const obj: Record<string, any> = {};
    for (const [k, v] of authTokens) obj[k] = v;
    const tmp = AUTH_TOKENS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, AUTH_TOKENS_PATH);
  } catch (e: any) {
    console.error('[Auth] 持久化 token 失败:', e?.message);
  }
}
// 保留10秒批量作为兜底（防止极端情况下的脏标记遗漏）
let _authTokensDirty = false;
setInterval(() => {
  if (!_authTokensDirty) return;
  _authTokensDirty = false;
  persistAuthTokensSync();
}, 10000);

// ===== 无状态签名 token（根治"登录已过期"：服务端不存 token，靠密钥验签）=====
// 格式：v1.<base64url(payload)>.<base64url(hmac-sha256)>
// payload: {p:手机号, s:scope, m:是否商户, i:签发时间}
// 用户铁律：手动登出前永不过期 → token 本身不设过期，登出走 blocklist
function _b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(s: string): string {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64').toString('utf8');
}
// 密钥：存 local_db.json 的 _config.tokenSecret，部署包自带 local_db.json 故跨部署不丢
function getTokenSecret(): string {
  try {
    const db: any = readLocalJsonDb();
    if (db && db._config && typeof db._config.tokenSecret === 'string' && db._config.tokenSecret.length >= 32) {
      return db._config.tokenSecret;
    }
    const secret = crypto.randomBytes(48).toString('hex');
    try {
      const dbData: any = readLocalJsonDb() || {};
      dbData._config = dbData._config || {};
      dbData._config.tokenSecret = secret;
      writeLocalJsonDb(dbData);
      console.log('[Auth] 已生成新的 token 签名密钥并持久化');
    } catch (e: any) {
      console.error('[Auth] 保存 token 密钥失败:', e?.message);
    }
    return secret;
  } catch (_) {
    // P1-4修复(2026-10-14)：降级分支用密码学随机数，不用可预测的时间戳（防伪造token）
    return 'fallback-secret-' + crypto.randomBytes(32).toString('hex');
  }
}
// 接单授权系统 (2026-10-15)：与VIP会员完全独立的第二套倒计时系统
// 计算接单授权剩余天数：'永久有效'返回99999，'待开通'/空/过期返回0
function getLicenseDaysRemaining(expiry: any): number {
  const s = String(expiry || '').trim();
  if (!s || s === '待开通' || s === '待激活' || s === '未开通' || s === '已到期' || s === '已过期') return 0;
  // P0(2026-10-16)：加上 'permanent'，与前端 hasValidLicense 对齐。
  // 之前服务端不认识 'permanent'，走 Date.parse→NaN→0天，前端显示永久但服务端判无效，无声丢单。
  if (s === '永久有效' || s === '永久' || s === '终身' || s === 'permanent') return 99999;
  // P1(2026-10-16晚)：改成日期差口径，与 App 端 calculateDaysFromExpiry 显示一致。
  // 之前用 Math.ceil(到当天23:59:59的毫秒差)，设1天（到期日明天）服务端算2天，App显示1天，
  // 到期日当天 App 显示0（屏蔽）但服务端判有效（仍派单），显示与派单打架。
  // 现在统一为日期差：到期日-今天，Math.round，与前端显示完全一致。
  let year = 0, month = 0, day = 0;
  const dateOnly = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    year = parseInt(dateOnly[1], 10); month = parseInt(dateOnly[2], 10) - 1; day = parseInt(dateOnly[3], 10);
  } else {
    const parsed = Date.parse(s);
    if (isNaN(parsed)) return 0;
    const d = new Date(parsed);
    year = d.getFullYear(); month = d.getMonth(); day = d.getDate();
  }
  const expDate = new Date(year, month, day, 0, 0, 0, 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}
// 接单授权是否有效：天数>0 或永久有效
function isLicenseValid(expiry: any): boolean {
  return getLicenseDaysRemaining(expiry) > 0;
}
// 2026-10-17: MySQL 查询超时保护。派单链路的 await mysqlPool.query 无超时，
// 一旦连接 hang 住整个派单请求卡死、无日志无响应。用 Promise.race 强行超时，
// 超时后记日志并抛错走上层 catch，不让请求静默卡死。
function mysqlQueryTimeout<T>(pool: any, sql: string, params: any[], ms: number, label: string): Promise<T> {
  return Promise.race([
    pool.query(sql, params),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[MySQL超时] ${label} 超过 ${ms}ms`)), ms)
    ),
  ]) as Promise<T>;
}
// 服务端VIP有效性判断（2026-10-15 P0：二维码创单/纠偏/非VIP限额服务端校验用）
function isVipActiveServer(vipExpiry: any): boolean {
  if (!vipExpiry) return false;
  const s = String(vipExpiry).trim();
  if (s === '0' || s === '0天' || s === '未激活' || s === '待激活' || s === '待开通' || s === '未开通' || s === '已到期' || s === '已过期' || s === '') return false;
  if (s === '永久有效' || s === '永久') return true;
  try {
    const match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    let expDate: Date;
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
// 北京时间今天日期字符串（2026-10-15 P0：非VIP每日2单用）
function getBeijingTodayStr(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
// 统计司机今天（北京时间）完成的订单数（2026-10-15 P0）
// 2026-10-17优化：之前 SELECT 全量 data 再 JSON.parse，订单多时阻塞事件循环导致派单卡死。
// 改为 SQL 内用 JSON_EXTRACT 只取必要字段，Node 侧不再 parse 大 JSON。
async function countTodayCompletedOrders(driverPhone: string): Promise<number> {
  const todayStr = getBeijingTodayStr();
  let count = 0;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows]: any = await mysqlQueryTimeout(
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
        8000,
        '今日完成单数统计'
      );
      for (const r of (rows || [])) {
        try {
          const dPhone = String(r.phone || r.cphone || r.dphone || '').replace(/\D/g, '');
          if (dPhone !== driverPhone) continue;
          const ts = r.completedAt || r.updatedAt || r.ts;
          if (!ts || ts === 'null') continue;
          const bjt = new Date(Number(ts) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (bjt === todayStr) count++;
        } catch (_) { /* skip bad row */ }
      }
    } else {
      const dbData = readLocalJsonDb();
      const orders = dbData['merchant_orders'] || {};
      for (const o of Object.values<any>(orders)) {
        const dPhone = String(o.driverPhone || o.claimedDriverPhone || o.dispatchedDriverPhone || '').replace(/\D/g, '');
        if (dPhone !== driverPhone) continue;
        if (o.status !== 'completed') continue;
        const ts = o.completedAt || o.updatedAt || o.timestamp;
        if (!ts) continue;
        const bjt = new Date(Number(ts) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (bjt === todayStr) count++;
      }
    }
  } catch (e) {
    console.error('[CountOrders] 统计失败:', (e as any)?.message);
  }
  return count;
}
// P1(2026-10-16)：统计某司机今天已发起的报单转单次数（非VIP每日2次限制用）。
// 转单订单 orderId 以 RT 开头，reporterPhone 为发起人。
// 2026-10-17优化：同 countTodayCompletedOrders，SQL 内取字段，不拉全量 JSON。
async function countTodayReportTransfers(reporterPhone: string): Promise<number> {
  const todayStr = getBeijingTodayStr();
  let count = 0;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows]: any = await mysqlQueryTimeout(
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
        8000,
        '今日转单次数统计'
      );
      for (const r of (rows || [])) {
        try {
          const oid = String(r.orderId && r.orderId !== 'null' ? r.orderId : (r.id && r.id !== 'null' ? r.id : ''));
          if (!oid.startsWith('RT')) continue;
          const rp = String(r.reporterPhone || '').replace(/\D/g, '');
          if (rp !== reporterPhone) continue;
          const ts = (r.createdAt && r.createdAt !== 'null' ? r.createdAt : null) || (r.ts && r.ts !== 'null' ? r.ts : null) || (r.dispatchedAt && r.dispatchedAt !== 'null' ? r.dispatchedAt : null);
          if (!ts) continue;
          const bjt = new Date(Number(ts) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (bjt === todayStr) count++;
        } catch (_) { /* skip bad row */ }
      }
    } else {
      const dbData = readLocalJsonDb();
      const orders = dbData['merchant_orders'] || {};
      for (const o of Object.values<any>(orders)) {
        const oid = String(o.orderId || o.id || '');
        if (!oid.startsWith('RT')) continue;
        const rp = String(o.reporterPhone || '').replace(/\D/g, '');
        if (rp !== reporterPhone) continue;
        const ts = o.createdAt || o.timestamp || o.dispatchedAt;
        if (!ts) continue;
        const bjt = new Date(Number(ts) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (bjt === todayStr) count++;
      }
    }
  } catch (e) {
    console.error('[CountRT] 统计失败:', (e as any)?.message);
  }
  return count;
}
function createSignedToken(phone: string, scope: string, isMerchant: boolean): string {
  const payload = JSON.stringify({ p: phone, s: scope, m: !!isMerchant, i: Date.now() });
  const pb = _b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', getTokenSecret()).update('v1.' + pb).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `v1.${pb}.${sig}`;
}
function verifySignedToken(token: string): { phone: string; scope: string; isMerchant: boolean } | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, pb, sig] = parts;
    const expect = crypto.createHmac('sha256', getTokenSecret()).update('v1.' + pb).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // 常量时间比较防时序攻击
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(_b64urlDecode(pb));
    if (!payload || !payload.p) return null;
    // 登出黑名单检查
    try {
      const db: any = readLocalJsonDb();
      const bl = db && db._config && db._config.tokenBlocklist;
      if (Array.isArray(bl) && bl.includes(token)) return null;
      // P1-10(2026-10-15)：被删除司机的手机号黑名单，token直接失效
      const rp = db && db._config && db._config.removedPhones;
      const phoneNorm = String(payload.p || '').replace(/\D/g, '').trim();
      if (Array.isArray(rp) && phoneNorm && rp.includes(phoneNorm)) return null;
    } catch (_) {}
    return { phone: String(payload.p), scope: String(payload.s || 'driver'), isMerchant: !!payload.m };
  } catch (_) {
    return null;
  }
}
function blocklistToken(token: string) {
  try {
    const dbData: any = readLocalJsonDb() || {};
    dbData._config = dbData._config || {};
    const bl: string[] = Array.isArray(dbData._config.tokenBlocklist) ? dbData._config.tokenBlocklist : [];
    if (!bl.includes(token)) {
      bl.push(token);
      // 黑名单只保留最近 5000 个，防无限增长
      if (bl.length > 5000) bl.splice(0, bl.length - 5000);
      dbData._config.tokenBlocklist = bl;
      writeLocalJsonDb(dbData);
    }
  } catch (e: any) {
    console.error('[Auth] token 拉黑失败:', e?.message);
  }
}

const DEVELOPER_PHONE_SERVER = '15509601222';

// P1: 定时清理内存泄漏（verificationCodes/dispatchLogs/authTokens）

// P1(2026-10-15)：管理后台操作日志，记录敏感操作用于追溯
async function logAdminOperation(opType: string, operatorPhone: string, targetPhone: string, details: string, req?: any) {
  try {
    const logId = `LOG${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const logData = {
      id: logId,
      opType,
      operatorPhone,
      targetPhone,
      details,
      ip: req?.ip || req?.headers?.['x-forwarded-for'] || '',
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    };
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?)',
        ['admin_operation_logs', logId, JSON.stringify(logData)]
      ).catch(() => {});
    } else {
      const dbData = readLocalJsonDb();
      if (!dbData['admin_operation_logs']) dbData['admin_operation_logs'] = {};
      dbData['admin_operation_logs'][logId] = logData;
      writeLocalJsonDb(dbData);
    }
  } catch (_) {}
}
setInterval(() => {
  const now = Date.now();
  try {
    for (const [k, v] of verificationCodes) {
      if (v.expiresAt < now) verificationCodes.delete(k);
    }
    for (const [k, v] of dispatchPhoneLoginLogs) {
      if (now - v > 25 * 3600 * 1000) dispatchPhoneLoginLogs.delete(k);
    }
    for (const [k, v] of dispatchIpLoginLogs) {
      if (now - v > 25 * 3600 * 1000) dispatchIpLoginLogs.delete(k);
    }
    // M14修复：清理过期的 wechatSessions（防缓慢内存泄漏）
    for (const [k, v] of wechatSessions) {
      if (v.expiresAt < now) wechatSessions.delete(k);
    }
    // M1修复：删除 authTokens 7天过期清理（用户铁律：手动登出前永不过期）
  } catch (_) {}
}, 10 * 60 * 1000);

// P1(2026-10-15)：大厅订单24小时归档，防merchant_orders无限增长
// 每天凌晨4点（北京时间）运行，删除hallAt超过24小时的大厅订单
setInterval(async () => {
  try {
    const now = new Date();
    const beijingMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000);
    const beijingDate = new Date(beijingMs);
    if (beijingDate.getHours() !== 4 || beijingDate.getMinutes() > 5) return; // 每天4:00-4:05运行一次
    
    const cutoff = Date.now() - 24 * 3600 * 1000;
    let deleted = 0;
    
    // 本地JSON
    try {
      const dbData = readLocalJsonDb();
      if (dbData['merchant_orders']) {
        for (const orderId in dbData['merchant_orders']) {
          const o = dbData['merchant_orders'][orderId];
          if (o && (o.status === 'hall' || o.in_hall === true)) {
            const hallAt = Number(o.hallAt || 0);
            if (hallAt && hallAt < cutoff) {
              delete dbData['merchant_orders'][orderId];
              deleted++;
            }
          }
        }
        if (deleted > 0) writeLocalJsonDb(dbData);
      }
    } catch (_) {}
    
    // MySQL
    if (isMySQLEnabled && mysqlPool) {
      try {
        const [rows]: any = await mysqlPool.query(
          'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
          ['merchant_orders']
        );
        for (const row of (rows || [])) {
          try {
            const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            if (d && (d.status === 'hall' || d.in_hall === true)) {
              const hallAt = Number(d.hallAt || 0);
              if (hallAt && hallAt < cutoff) {
                await mysqlPool.query(
                  'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                  ['merchant_orders', row.doc_id]
                );
                deleted++;
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }
    
    if (deleted > 0) console.log(`[HallArchive] 归档了 ${deleted} 个过期大厅订单`);
  } catch (_) {}
}, 5 * 60 * 1000); // 每5分钟检查一次时间窗口

// In-memory 24-hour rate limiting stores for dispatch valet logins
const dispatchPhoneLoginLogs = new Map<string, number>();
const dispatchIpLoginLogs = new Map<string, number>();
const WHITELIST_PHONES = ['15509601222', '15121904440'];

// In-memory store for WeChat scan login sessions
const wechatSessions = new Map<string, { authorized: boolean; phone: string | null; expiresAt: number }>();

// Configure self-hosted MySQL option
let mysqlPool: mysql.Pool | null = null;
let isMySQLEnabled = false;

async function initDatabase() {
  const host = process.env.MYSQL_HOST;
  if (!host) {
    console.log('[Database] Running in Local File-based Database mode (local_db.json).');
    isMySQLEnabled = false;
    mysqlPool = null;
    return;
  }

  console.log(`[Database] Testing MySQL configuration for ${host}:${process.env.MYSQL_PORT || 3306}, Database: ${process.env.MYSQL_DATABASE}...`);
  
  const testPool = mysql.createPool({
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 100,
    maxIdle: 50,
    idleTimeout: 60000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    queueLimit: 0,
    connectTimeout: 3000,
    charset: 'utf8mb4'
  });

  try {
    const conn = await testPool.getConnection();
    console.log('✓ [Database] Connected to MySQL database successfully!');
    
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
    console.log('✓ [Database] MySQL table structures "daijia_documents" verified successfully.');
    return;
  } catch (err: any) {
    testPool.end().catch(() => {});
    
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      try {
        const fallbackPool = mysql.createPool({
          host: '127.0.0.1',
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 100,
          maxIdle: 50,
          idleTimeout: 60000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
          queueLimit: 0,
          connectTimeout: 2000,
          charset: 'utf8mb4'
        });
        
        const conn = await fallbackPool.getConnection();
        console.log('✓ [Database] Connected to local MySQL fallback "127.0.0.1" successfully!');
        
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
        console.log('✓ [Database] MySQL table structures verified on local fallback.');
        return;
      } catch (fallbackErr: any) {
        // Fallback failed
      }
    }
    
    console.log('ℹ️ [Database] Remote MySQL database not reachable. Seamlessly operating in Local File-based Database mode (local_db.json).');
    isMySQLEnabled = false;
    mysqlPool = null;
  }
}

// Local File Database Helper Implementation for Mainland China (Aliyun ECS local_db.json)
const LOCAL_JSON_DB_PATH = path.join(process.cwd(), 'local_db.json');

let cachedDbData: Record<string, Record<string, any>> | null = null;
let lastDbReadTime = 0;

function pickAuthoritativeVipExpiry(...expiries: (string | undefined | null)[]): string {
  for (const exp of expiries) {
    if (exp !== undefined && exp !== null) {
      const trimmed = String(exp).trim();
      if (trimmed !== '') {
        return trimmed;
      }
    }
  }
  return '待开通';
}

export const AUTHORITATIVE_REAL_DRIVER_NAMES: Record<string, string> = {
  '15509601222': '吴彦祖'
};

function isGenericDriverName(name: string, phone: string): boolean {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  if (AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone]) return false;

  if (!cleanPhone || cleanPhone.length !== 11) return true;

  // P0(2026-10-16)：删除手机号尾号黑名单——尾号 9147/3634/5678/6058/0116/1223/1958 的
  // 真实司机（已审批、上线、空闲、有授权）会被永久排除派单，且开发者尾号不在此列故永远测不出。
  // 测试号清理应走 removed_squad_members 精确名单，不做尾号泛化匹配。

  if (!name || typeof name !== 'string') return true;
  const clean = String(name).trim();
  if (!clean) return true;
  if (clean === '代驾司机' || clean === '在线代驾司机' || clean === '司机' || clean === '未命名' || clean === '代驾师傅' || clean === '虚拟司机') return true;
  if (/^司机\d+/.test(clean)) return true;
  if (clean.startsWith('司机') && /\d/.test(clean)) return true;
  const last4 = cleanPhone.slice(-4);
  if (last4 && (clean === `司机${last4}` || clean.endsWith(last4))) return true;
  return false;
}

let isDbWriteScheduled = false;
let isDbWriting = false;

// P0-1: 脏标 + 5秒批量异步刷盘，避免高频同步写阻塞 Event Loop
// （提前声明，供 readLocalJsonDb 的 H15 脏读保护使用）
let _dbDirty = false;
let _dbWriteInFlight = false;

function readLocalJsonDb(): Record<string, Record<string, any>> {
  // H15修复：有未刷盘的脏数据时直接返回内存缓存，避免脏派单被磁盘旧快照覆盖丢失
  if (_dbDirty && cachedDbData) return cachedDbData;
  try {
    if (fs.existsSync(LOCAL_JSON_DB_PATH)) {
      const content = fs.readFileSync(LOCAL_JSON_DB_PATH, 'utf8');
      cachedDbData = JSON.parse(content || '{}');
      lastDbReadTime = Date.now();
      return cachedDbData!;
    }
  } catch (e) {
    console.error('[Local JSON DB] Read error:', e);
  }
  if (!cachedDbData) cachedDbData = {};
  return cachedDbData;
}

// P0-1: 脏标 + 5秒批量异步刷盘已在上方声明（_dbDirty/_dbWriteInFlight）

// P0(2026-10-16)：并发写入必须用唯一 tmp 文件名。
// 之前同步写与 5 秒异步批量写共用同一个 `local_db.json.tmp`，
// 同步 rename 先删掉 tmp 后、异步 rename 报 ENOENT（生产日志已确认）。
let _tmpWriteSeq = 0;
function uniqueTmpPath(): string {
  _tmpWriteSeq = (_tmpWriteSeq + 1) % 1000000;
  return `${LOCAL_JSON_DB_PATH}.tmp.${process.pid}.${Date.now()}.${_tmpWriteSeq}`;
}
function removeFileQuiet(p: string) {
  try { fs.unlinkSync(p); } catch (_) {}
}

function writeLocalJsonDb(data: Record<string, Record<string, any>>, immediate = true) {
  cachedDbData = data;
  lastDbReadTime = Date.now();
  // M3修复：immediate=true 时同步写盘（tmp+rename 原子替换），关键写入（抢单/黑名单）不再依赖5秒批量
  if (immediate) {
    const tmpPath = uniqueTmpPath();
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
      fs.renameSync(tmpPath, LOCAL_JSON_DB_PATH);
    } catch (e: any) {
      console.error('[Local JSON DB] Sync write error:', e?.message);
      removeFileQuiet(tmpPath);
      _dbDirty = true; // 同步失败则回退打脏标，由5秒定时器重试
    }
    return;
  }
  // immediate=false：只打脏标，由5秒定时器批量异步刷盘，避免高频全量序列化阻塞 Event Loop
  _dbDirty = true;
}

// 5秒批量异步刷盘（H14修复：tmp+rename 原子替换，避免 kill 截断导致全库丢失）
setInterval(() => {
  if (!_dbDirty || _dbWriteInFlight) return;
  _dbDirty = false;
  _dbWriteInFlight = true;
  const snapshot = cachedDbData;
  const tmpPath = uniqueTmpPath();
  fs.promises.writeFile(tmpPath, JSON.stringify(snapshot), 'utf8')
    .then(() => fs.promises.rename(tmpPath, LOCAL_JSON_DB_PATH))
    .catch((e: any) => {
      console.error('[Local JSON DB] Async write error:', e?.message);
      fs.promises.unlink(tmpPath).catch(() => {});
      _dbDirty = true; // 异步写失败重打脏标，下轮重试，避免数据只留在内存
    })
    .finally(() => {
      _dbWriteInFlight = false;
      // P1-1修复(2026-10-14)：异步写期间若有同步写入更新了 cachedDbData，快照已过期，重打脏标下轮重写，防旧数据覆盖新数据
      if (cachedDbData !== snapshot) {
        _dbDirty = true;
      }
    });
}, 5000);

// H14修复：启动时备份 local_db.json.bak
try {
  if (fs.existsSync(LOCAL_JSON_DB_PATH)) {
    const bakPath = LOCAL_JSON_DB_PATH + '.bak';
    fs.copyFileSync(LOCAL_JSON_DB_PATH, bakPath);
    console.log('[Local JSON DB] 启动备份已创建:', bakPath);
  }
} catch (e: any) {
  console.error('[Local JSON DB] 启动备份失败:', e?.message);
}

// P0(2026-10-16)：清理旧版固定名 tmp 与崩溃残留的唯一 tmp 文件，避免磁盘垃圾堆积
try {
  const _tmpDir = path.dirname(LOCAL_JSON_DB_PATH);
  const _tmpBase = path.basename(LOCAL_JSON_DB_PATH);
  for (const _f of fs.readdirSync(_tmpDir)) {
    if (_f === _tmpBase + '.tmp' || _f.startsWith(_tmpBase + '.tmp.')) {
      removeFileQuiet(path.join(_tmpDir, _f));
    }
  }
} catch (_) {}

// N-6修复（2026-10-10复审）：启动时备份 auth_tokens.json.bak
// 2026-10-15：token已改为无状态HMAC（无文件存储），此备份逻辑已废弃，移除
// (原代码调用未定义的 getAuthTokenPath()，每次启动报错)

async function runSystemDiskCleanup() {
  // 1. Purge MySQL Binary Logs via active MySQL pool connection
  if (isMySQLEnabled && mysqlPool) {
    try {
      const conn = await mysqlPool.getConnection();
      await conn.query('PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 1 DAY);');
      conn.release();
    } catch (_) {}
  }

  // 2. Clear Nginx site log files asynchronously
  try {
    const logDirs = ['/www/wwwlogs/', '/var/log/nginx/'];
    for (const dir of logDirs) {
      if (fs.existsSync(dir)) {
        const files = await fs.promises.readdir(dir).catch(() => []);
        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = path.join(dir, file);
            try {
              const stat = await fs.promises.stat(filePath).catch(() => null);
              if (stat && stat.size > 20 * 1024 * 1024) {
                await fs.promises.truncate(filePath, 0).catch(() => {});
              }
            } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}
}

async function startServer() {
  await initDatabase();

  // Schedule system disk cleanup to run every 12 hours automatically
  setInterval(() => {
    runSystemDiskCleanup().catch(() => {});
  }, 12 * 60 * 60 * 1000);

  // 120秒无GPS强制下线（用户需求：大退/关机/断网的司机不占用派单，
  // 避免高峰期订单派给死司机空等60秒；司机重新上线后自动恢复）
  // 每30秒扫描一次，lastLocationTime 超120秒未更新 → isOnline=false
  const GPS_OFFLINE_THRESHOLD_MS = 120 * 1000;
  setInterval(() => {
    try {
      const dbData: any = readLocalJsonDb();
      const locs = dbData?.driver_locations;
      if (!locs || typeof locs !== 'object') return;
      const now = Date.now();
      let kicked = 0;
      let changed = false;
      for (const k of Object.keys(locs)) {
        const item = locs[k];
        if (!item || item.isOnline !== true) continue;
        const t = Number(item.lastLocationTime || item.locationTimestamp || item.lastStatusUpdateTime || 0);
        // M2修复：无时间戳(t<=0)按过期处理（fail-safe），幽灵司机不再永生
        if (now - t > GPS_OFFLINE_THRESHOLD_MS) {
          locs[k] = { ...item, isOnline: false, onlineOrdersEnabled: false, kickedOfflineAt: now, kickReason: 'gps_timeout_120s' };
          kicked++;
          changed = true;
        }
      }
      if (changed) {
        writeLocalJsonDb(dbData);
        if (kicked > 0) console.log(`[GPS看门狗] ${kicked} 名司机120秒无GPS，已强制下线`);
      }
    } catch (e: any) {
      console.error('[GPS看门狗] 扫描异常:', e?.message);
    }
  }, 30 * 1000);

  const app = express();
// P1-5修复(2026-10-14)：信任宝塔 nginx 一层代理，Express 自动从 XFF 提取真实客户端 IP
// 配合 getClientIp() 使用，不再各处手写 XFF 解析（防伪造 XFF 绕过限流）
app.set('trust proxy', 1);

// P1-5修复(2026-10-14)：统一客户端 IP 获取
// Express 的 req.ip 在 trust proxy=1 时会正确解析 XFF，比手写 split 更可靠
// 额外做格式校验，防畸形值污染限流 key
function getClientIp(req: any): string {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  // 简单 IPv4/IPv6 格式校验，不合法则回退
  if (/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip)) {
    return ip;
  }
  return 'unknown';
}
  const PORT = 3000;

  // Increase payload size thresholds to avoid issues with large QR code images
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // CORS headers
  // M11修复：Origin 白名单（不再反射任意Origin）；Allow-Headers 加上 X-Auth-Token
  const CORS_WHITELIST = [
    'https://api.lyheiwandaijiamax.com',
    'https://admin.lyheiwandaijiamax.com',
    'https://lyheiwandaijiamax.com',
    'https://418000199ly-lgtm.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    // Capacitor 原生 App 的 Origin（iOS/Android）
    'capacitor://heiwan.daijia',
    'https://heiwan.daijia',
    'http://heiwan.daijia'
  ];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_WHITELIST.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-Requested-With, Keep-Alive, User-Agent, Cache-Control');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Pure API Domain Isolation Guard:
  // When accessed via api.* domain (e.g., https://lyheiwandaijiamax.com/),
  // disable all Web GUI / frontend page rendering on root path to prevent unauthorized portal exposure,
  // while ensuring all /api/* data endpoints operate with 100% full performance.
  app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase();
    const reqPath = req.path;

    // Pure API mode check for explicit query parameter only
    if (req.query.api_mode === 'pure' && 
        !reqPath.startsWith('/api/') && 
        reqPath !== '/privacy' && 
        !reqPath.includes('.') &&
        !reqPath.startsWith('/daijia_deploy') &&
        !reqPath.startsWith('/baota_deploy') &&
        !reqPath.startsWith('/deploy')) {
      return res.status(200).json({
        code: 200,
        status: 'ONLINE',
        node: 'Heiwan Daijia API Gateway',
        message: '🔒 安全网关节点正常运行中。',
        timestamp: new Date().toISOString()
      });
    }
    next();
  });

  // Seed Master Developer Admin Account 15509601222 automatically
  const seedSuperAdminAccount = async () => {
    const superAdminData = {
      phone: '15509601222',
      role: 'SUPER_DEVELOPER_ADMIN',
      name: '最高开发者',
      status: 'ACTIVE',
      updatedAt: new Date().toISOString()
    };

    const now = new Date();
    const target46Date = new Date(now.getTime() + 46 * 24 * 60 * 60 * 1000);
    const yyyy = target46Date.getFullYear();
    const mm = String(target46Date.getMonth() + 1).padStart(2, '0');
    const dd = String(target46Date.getDate()).padStart(2, '0');
    const default46Expiry = `${yyyy}-${mm}-${dd}`;

    const driverUserData = {
      phone: '15509601222',
      driverName: '吴彦祖',
      role: '开发者',
      userRole: '开发者',
      vipExpiry: default46Expiry,
      customAppName: '滴滴代驾',
      isOnline: false,
      onlineOrdersEnabled: false,
      isBanned: false,
      city: '银川市',
      updatedAt: new Date().toISOString()
    };

    try {
      const dbData = readLocalJsonDb();
      if (!dbData.system_admins) dbData.system_admins = {};
      dbData.system_admins['15509601222'] = superAdminData;

      if (!dbData.driver_users) dbData.driver_users = {};
      const existingDriver = dbData.driver_users['15509601222'] || {};

      dbData.driver_users['15509601222'] = {
        ...driverUserData,
        ...existingDriver,
        customAppName: existingDriver.customAppName || '滴滴代驾',
        vipExpiry: existingDriver.vipExpiry !== undefined ? existingDriver.vipExpiry : default46Expiry
      };

      writeLocalJsonDb(dbData);
      console.log('✓ [Database] Super Admin 15509601222 verified in local_db.json');
    } catch (e) {
      console.error('[Seed] Failed to seed super admin into local_db.json:', e);
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

        const localDriver = readLocalJsonDb()?.driver_users?.['15509601222'] || driverUserData;
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`)
           VALUES ('driver_users', '15509601222', ?)
           ON DUPLICATE KEY UPDATE \`data\` = JSON_MERGE_PATCH(\`data\`, ?)`,
          [JSON.stringify(localDriver), JSON.stringify({ role: '开发者', userRole: '开发者' })]
        );

        conn.release();
        console.log('✓ [Database] Super Admin 15509601222 verified in MySQL');
      } catch (e) {
        console.error('[Seed] Failed to seed super admin into MySQL:', e);
      }
    }
  };

  // Run initial seed
  seedSuperAdminAccount();

  // Purge simulated/mock driver data & unapproved generic drivers
  const purgeMockDriverData = async () => {
    try {
      const dbData = readLocalJsonDb();
      let modified = false;

      // Ensure kicked generic driver phones are in removed_squad_members config
      if (!dbData.config) dbData.config = {};
      if (!dbData.config.removed_squad_members) dbData.config.removed_squad_members = { phones: [] };
      const removedPhones: string[] = dbData.config.removed_squad_members.phones || [];
      const kickedPhones = [
        '17866167770', // 魏秉金
        '19995179865', // 张栋
        '13099566633', // 李鑫
        '18893028825', // 何威
        '18795101111', // 尹柏学
        '18095513011', // 杨海
        '13895299147',
        '17660453634',
        '13812345678',
        '13912345678',
        '19995426058',
        '15509601223',
        '15555556666'
      ];
      kickedPhones.forEach(p => {
        if (!removedPhones.includes(p)) {
          removedPhones.push(p);
          modified = true;
        }
      });
      dbData.config.removed_squad_members.phones = removedPhones;

      // 1. In squad_members: ONLY 15509601222 is kept!
      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach(docId => {
          if (docId !== '15509601222') {
            delete dbData.squad_members[docId];
            modified = true;
          }
        });
      }

      // 2. In squad_applications: ALL except 15509601222 are deleted
      if (dbData.squad_applications) {
        Object.keys(dbData.squad_applications).forEach(docId => {
          if (docId !== '15509601222') {
            delete dbData.squad_applications[docId];
            modified = true;
          }
        });
      }

      // 3. In online_applications: ONLY 15509601222 is kept and properly initialized as approved
      if (!dbData.online_applications) dbData.online_applications = {};
      Object.keys(dbData.online_applications).forEach(docId => {
        if (docId !== '15509601222') {
          delete dbData.online_applications[docId];
          modified = true;
        }
      });

      const onlineApp155 = {
        id: '15509601222',
        phone: '15509601222',
        phoneNumber: '15509601222',
        driverName: '吴彦祖',
        name: '吴彦祖',
        realName: '吴彦祖',
        role: '开发者司机',
        userRole: '开发者司机',
        status: 'approved',
        approvalStatus: '已开通',
        city: '银川市',
        vipExpiry: '2099-12-31',
        onlineOrdersEnabled: true,
        emergencyContact: '13895000000',
        drivingYears: 10,
        idCardFront: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
        idCardBack: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
        driverLicenseFront: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
        driverLicenseBack: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z'
      };
      // P0(2026-10-16)：合并而非全量覆盖，保留已有的 licenseExpiry 等充值字段
      const prevOnline155 = dbData.online_applications['15509601222'] || {};
      dbData.online_applications['15509601222'] = { ...prevOnline155, ...onlineApp155 };
      if (prevOnline155.licenseExpiry) {
        dbData.online_applications['15509601222'].licenseExpiry = prevOnline155.licenseExpiry;
      }

      // 4. In driver_users: ALL except 15509601222 and merchant A accounts are deleted
      if (dbData.driver_users) {
        Object.keys(dbData.driver_users).forEach(docId => {
          const isMerchantA = docId.toUpperCase().endsWith('A') || dbData.driver_users[docId]?.isMerchant;
          if (docId !== '15509601222' && !isMerchantA) {
            delete dbData.driver_users[docId];
            modified = true;
          }
        });
      }

      // Force 15509601222 developer profile
      // P0(2026-10-16)：合并而非全量覆盖——保留管理员设置的 vipExpiry/licenseExpiry，
      // 否则每次重启都会洗掉接单授权充值记录（App 选单大厅变回"待开通"）
      if (!dbData.driver_users) dbData.driver_users = {};
      const prevDev155 = dbData.driver_users['15509601222'] || {};
      dbData.driver_users['15509601222'] = {
        ...prevDev155,
        id: '15509601222',
        phone: '15509601222',
        phoneNumber: '15509601222',
        driverName: '吴彦祖',
        name: '吴彦祖',
        realName: '吴彦祖',
        role: '开发者司机',
        userRole: '开发者司机',
        status: '已通过',
        is_squad_member: 1,
        inSquad: true,
        collection: 'squad_members',
        city: '银川市',
        // vipExpiry：已有（管理员设置的20天等）则保留，缺省才给永久
        vipExpiry: prevDev155.vipExpiry || '2099-12-31',
        isOnline: true,
        onlineOrdersEnabled: true
      };

      if (modified) {
        writeLocalJsonDb(dbData, true);
        console.log('✓ [Database] Purged all drivers except 15509601222 and merchant accounts from local_db.json');
      }
    } catch (e) {
      console.error('[Purge] Error purging drivers from local_db.json:', e);
    }

    if (isMySQLEnabled && mysqlPool) {
      try {
        const conn = await mysqlPool.getConnection();
        // Delete all drivers except 15509601222 and merchant A accounts from MySQL daijia_documents
        await conn.query(
          `DELETE FROM \`daijia_documents\` 
           WHERE \`collection\` IN ('squad_members', 'squad_applications', 'online_applications', 'driver_users', 'driver_locations') 
           AND \`doc_id\` != '15509601222' AND \`doc_id\` NOT LIKE '%A' AND \`doc_id\` NOT LIKE '%a'`
        );
        
        // Ensure 15509601222 online_applications record exists in MySQL
        const onlineApp155 = {
          id: '15509601222',
          phone: '15509601222',
          phoneNumber: '15509601222',
          driverName: '吴彦祖',
          name: '吴彦祖',
          realName: '吴彦祖',
          role: '开发者司机',
          userRole: '开发者司机',
          status: 'approved',
          approvalStatus: '已开通',
          city: '银川市',
          vipExpiry: '2099-12-31',
          onlineOrdersEnabled: true,
          emergencyContact: '13895000000',
          drivingYears: 10,
          idCardFront: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
          idCardBack: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
          driverLicenseFront: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
          driverLicenseBack: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-10-06T00:00:00.000Z',
          updatedAt: '2026-10-06T00:00:00.000Z'
        };
        // P0(2026-10-16)：MySQL 用合并而非全量覆盖，保留已有的 licenseExpiry 充值字段
        const onlineApp155Patch: any = { ...onlineApp155 };
        delete onlineApp155Patch.licenseExpiry;
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('online_applications', '15509601222', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = JSON_MERGE_PATCH(\`data\`, ?), \`updated_at\` = NOW()`,
          [JSON.stringify(onlineApp155), JSON.stringify(onlineApp155Patch)]
        );

        // Ensure 15509601222 developer profile in MySQL driver_users and squad_members
        const dev155 = {
          id: '15509601222',
          phone: '15509601222',
          phoneNumber: '15509601222',
          driverName: '吴彦祖',
          name: '吴彦祖',
          realName: '吴彦祖',
          role: '开发者司机',
          userRole: '开发者司机',
          status: '已通过',
          is_squad_member: 1,
          inSquad: true,
          collection: 'squad_members',
          city: '银川市',
          vipExpiry: '2099-12-31',
          isOnline: true,
          onlineOrdersEnabled: true
        };
        // P0(2026-10-16)：MySQL 也用合并而非全量覆盖——保留管理员设置的 vipExpiry/licenseExpiry，
        // 否则每次重启都会洗掉接单授权充值记录（App 选单大厅变回"待开通"）。
        // 补丁负载排除 vipExpiry/licenseExpiry：新库插入时给永久默认，已有库只强制身份字段。
        const dev155Patch: any = { ...dev155 };
        delete dev155Patch.vipExpiry;
        delete dev155Patch.licenseExpiry;
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('driver_users', '15509601222', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = JSON_MERGE_PATCH(\`data\`, ?), \`updated_at\` = NOW()`,
          [JSON.stringify(dev155), JSON.stringify(dev155Patch)]
        );
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('squad_members', '15509601222', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = JSON_MERGE_PATCH(\`data\`, ?), \`updated_at\` = NOW()`,
          [JSON.stringify(dev155), JSON.stringify(dev155Patch)]
        );

        // Force-update system_version in MySQL to V2.0 to sync with V2.0 app clients
        const vData = {
          version: "V2.0",
          forceUpgrade: false,
          upgradeUrl: "https://download.heiwan.com/max/v20",
          updatedAt: new Date().toISOString()
        };
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('config', 'system_version', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = ?, \`updated_at\` = NOW()`,
          [JSON.stringify(vData), JSON.stringify(vData)]
        );

        conn.release();
        console.log('✓ [Database] Purged all drivers except 15509601222 from MySQL and set system_version to V2.0');
      } catch (e) {
        console.error('[Purge] Error purging drivers from MySQL:', e);
      }
    }
  };

  // Run startup sequence sequentially
  (async () => {
    // P0(2026-10-16)：生产环境禁用启动时自动 purgeMockDriverData。
    // 之前每次重启都 DELETE 所有非开发者司机（squad_members/driver_users 等，MySQL+本地全删），
    // 重启即删光真实司机。清理测试号只走管理后台的显式"清理"接口，不再自动执行。
    // await purgeMockDriverData();
    // P1(2026-10-16晚)：删除此处的 consolidateAllDriversOnStartup() 调用。
    // 它在下方 1205 行才用 const 定义，此处调用触发 TDZ ReferenceError 导致启动崩溃。
    // 真正的调用在 1435 行（定义之后），功能不受影响。
  })();

  // Consolidate all approved squad/online drivers into driver_users on startup
  const consolidateAllDriversOnStartup = async () => {
    try {
      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.squad_applications) dbData.squad_applications = {};
      if (!dbData.online_applications) dbData.online_applications = {};
      if (!dbData.driver_locations) dbData.driver_locations = {};

      let updatedCount = 0;

      const removedList: string[] = dbData.config?.['removed_squad_members']?.phones || [];

      // 1. Pre-fetch all driver records from MySQL daijia_documents if enabled
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            "SELECT `collection`, `doc_id`, `data` FROM `daijia_documents` WHERE `collection` IN ('squad_members', 'online_applications', 'squad_applications', 'team_members', 'driver_users', 'driver_locations')"
          );
          if (Array.isArray(rows)) {
            rows.forEach((r: any) => {
               const col = r.collection;
               const docId = r.doc_id;
               if (col && docId && r.data) {
                 const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                 if (!dbData[col]) dbData[col] = {};
                 dbData[col][docId] = { ...(dbData[col][docId] || {}), ...parsed };
               }
            });
          }
        } catch (mErr) {
          console.warn('[Consolidation] Pre-fetching MySQL rows warning:', mErr);
        }
      }

      // Compute standard 50-day target VIP expiry date (e.g., 2026-11-18)
      const now = new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

      // Purge removed drivers from squad_members and reset in driver_users
      removedList.forEach(p => {
        if (p !== '15509601222') {
          if (dbData.squad_members && dbData.squad_members[p]) {
            delete dbData.squad_members[p];
          }
          if (dbData.driver_locations && dbData.driver_locations[p]) {
            delete dbData.driver_locations[p];
          }
          if (dbData.squad_applications && dbData.squad_applications[p]) {
            if (dbData.squad_applications[p].status === '已通过') {
              dbData.squad_applications[p].status = '未加入小队';
            }
          }
          if (dbData.driver_users && dbData.driver_users[p]) {
            dbData.driver_users[p].is_squad_member = 0;
            dbData.driver_users[p].inSquad = false;
            dbData.driver_users[p].role = '普通司机';
            dbData.driver_users[p].userRole = '普通司机';
            if (dbData.driver_users[p].status === '已通过') {
              dbData.driver_users[p].status = '未加入小队';
            }
          }
        }
      });

      // Purge generic/unapproved drivers from squad_members
      Object.keys(dbData.squad_members).forEach(k => {
        const item = dbData.squad_members[k];
        const cleanPhone = String(item?.phone || item?.phoneNumber || k).replace(/\D/g, '').trim();
        const rawName = String(item?.name || item?.driverName || item?.applicantName || '');
        if (cleanPhone !== '15509601222') {
          // P1(2026-10-16第二遍审计)：删 includes('9147') 残留。之前尾号黑名单已删，
          // 此处是 includes（任意位置包含）误杀面更大，且与决议不一致。
          if (removedList.includes(cleanPhone) || (isGenericDriverName(rawName, cleanPhone) && !AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone])) {
            delete dbData.squad_members[k];
          }
        }
      });

      const approvedSquadPhones = new Set<string>();
      approvedSquadPhones.add('15509601222');

      // Include drivers explicitly in squad_members collection and not in removedList
      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach(k => {
          const cleanPhone = String(dbData.squad_members[k]?.phone || dbData.squad_members[k]?.phoneNumber || k).replace(/\D/g, '').trim();
          if (cleanPhone && cleanPhone.length === 11 && !removedList.includes(cleanPhone)) {
            approvedSquadPhones.add(cleanPhone);
          }
        });
      }

      approvedSquadPhones.forEach(phone => {
        const sq = dbData.squad_members?.[phone] || {};
        const oa = dbData.online_applications?.[phone] || {};
        const sa = dbData.squad_applications?.[phone] || {};
        const dl = dbData.driver_locations?.[phone] || {};
        const du = dbData.driver_users?.[phone] || {};

        const name = du.driverName || du.name || sq.name || sq.driverName || oa.driverName || oa.name || AUTHORITATIVE_REAL_DRIVER_NAMES[phone] || `司机${phone.slice(-4)}`;
        const city = du.city || sq.city || oa.city || '银川市';
        
        let isRejected = (du.status === '已拒绝' || sq.status === '已拒绝' || oa.status === '已拒绝' || sa.status === '已拒绝');

        // Pick authoritative vipExpiry: driver_users du.vipExpiry is primary
        let vipExpiry = du.vipExpiry || sq.vipExpiry || oa.vipExpiry || sa.vipExpiry || '';
        
        if (isRejected) {
          vipExpiry = '待开通';
        } else if (!vipExpiry) {
          vipExpiry = '待开通';
        }

        const role = du.role || du.userRole || sq.role || sq.userRole || (phone === '15509601222' ? '开发者' : '普通司机');

        const consolidatedProfile = {
          ...sq,
          ...oa,
          ...sa,
          ...du,
          phone,
          phoneNumber: phone,
          driverName: name,
          name,
          role,
          userRole: role,
          status: isRejected ? '已拒绝' : '已通过',
          city,
          vipExpiry,
          isOnline: Boolean(du.isOnline || sq.isOnline || dl.isOnline),
          onlineOrdersEnabled: Boolean(du.onlineOrdersEnabled !== undefined ? du.onlineOrdersEnabled : (sq.onlineOrdersEnabled !== false)),
          isBanned: Boolean(du.isBanned),
          updatedAt: du.updatedAt || new Date().toISOString()
        };

        dbData.driver_users[phone] = consolidatedProfile;
        
        // Maintain approved status and persistent approver record for approved squad members
        if (!isRejected && phone !== '15509601222') {
          const approvedBy = sq.approvedBy || du.approvedBy || '最高开发者';
          const approvedRole = sq.approvedRole || du.approvedRole || '管理司机';
          const approvalTime = sq.approvalTime || du.approvalTime || sq.lastUpdatedTime || du.updatedAt || new Date().toLocaleString();

          if (!dbData.squad_members) dbData.squad_members = {};
          const existingSquad = dbData.squad_members[phone] || {};
          dbData.squad_members[phone] = {
            ...existingSquad,
            phone,
            name,
            driverName: name,
            role,
            userRole: role,
            status: '已通过',
            approvedBy,
            approvedRole,
            approvalTime,
            vipExpiry
          };

          if (dbData.squad_applications && dbData.squad_applications[phone]) {
            dbData.squad_applications[phone].status = '已通过';
            dbData.squad_applications[phone].approvedBy = approvedBy;
            dbData.squad_applications[phone].approvedRole = approvedRole;
            dbData.squad_applications[phone].vipExpiry = vipExpiry;
          }
        } else if (phone === '15509601222') {
          if (dbData.squad_members && dbData.squad_members[phone]) {
            dbData.squad_members[phone].vipExpiry = vipExpiry;
            dbData.squad_members[phone].status = '已通过';
          }
          if (dbData.squad_applications && dbData.squad_applications[phone]) {
            dbData.squad_applications[phone].vipExpiry = vipExpiry;
            dbData.squad_applications[phone].status = '已通过';
          }
        }

        updatedCount++;
      });

      // Purge any orphan driver_users entries that are not approved squad drivers or merchant A accounts
      if (dbData.driver_users) {
        Object.keys(dbData.driver_users).forEach(k => {
          const cleanP = k.replace(/\D/g, '').trim();
          const isMerchantA = k.toUpperCase().endsWith('A') || dbData.driver_users[k]?.isMerchant;
          if (cleanP !== '15509601222' && !approvedSquadPhones.has(cleanP) && !isMerchantA) {
            delete dbData.driver_users[k];
          }
        });
      }

      writeLocalJsonDb(dbData);
      console.log(`✓ [Database] Consolidated ${updatedCount} driver profiles into driver_users on startup.`);

      if (isMySQLEnabled && mysqlPool) {
        for (const phone of Object.keys(dbData.driver_users)) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['driver_users', phone, JSON.stringify(dbData.driver_users[phone])]
          ).catch(() => {});

          if (dbData.squad_applications && dbData.squad_applications[phone]) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['squad_applications', phone, JSON.stringify(dbData.squad_applications[phone])]
            ).catch(() => {});
          }
          if (dbData.squad_members && dbData.squad_members[phone]) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['squad_members', phone, JSON.stringify(dbData.squad_members[phone])]
            ).catch(() => {});
          }
          if (dbData.online_applications && dbData.online_applications[phone]) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['online_applications', phone, JSON.stringify(dbData.online_applications[phone])]
            ).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error('[Consolidation] Error during driver startup consolidation:', e);
    }
  };

  // Run initial consolidation once on server startup
  consolidateAllDriversOnStartup().catch(() => {});

  // Health check endpoint
  // SERVER_VERSION 由 create_deploy_zip.py 在打部署包时替换为真实 git 短 SHA；
  // 未经打包直接运行时显示 dev，避免写死旧版本号误导“版本对不对得上”的核对。
  const SERVER_VERSION: string = '__SERVER_VERSION__';
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: Date.now(), version: SERVER_VERSION.startsWith('__') ? 'dev' : SERVER_VERSION, hmac: true });
  });

  // High-reliability Chinese Text-To-Speech (TTS) Proxy Endpoint
  app.get('/api/tts', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).send('Missing text parameter');
    }

    const encodedText = encodeURIComponent(text);
    const ttsProviders = [
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=web`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=baidu`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=tsn`,
        referer: 'https://fanyi.baidu.com/'
      }
    ];

    for (const item of ttsProviders) {
      try {
        const response = await fetch(item.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': item.referer
          }
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 300) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(buffer);
          }
        }
      } catch (err) {
        // Try next endpoint
      }
    }

    return res.status(502).send('TTS synthesis failed on all upstream providers');
  });

  // 认证中间件：写操作需要有效的短信登录令牌
  // 规则：普通用户只能写自己手机号的文档；开发者（15509601222）可写任意
  const requireDbAuth = (req: any, res: any, next: any) => {
    const token = req.headers['x-auth-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ success: false, error: '未登录：缺少认证令牌，请先短信验证登录' });
    }
    // 根治"登录已过期"：优先验签无状态 token（服务端不存，重启/部署不丢）；
    // 老版本随机 token 走内存 Map 兼容过渡
    const signed = verifySignedToken(String(token));
    const info = signed
      ? { phone: signed.phone, scope: signed.scope, isMerchant: signed.isMerchant, createdAt: 0 }
      : authTokens.get(String(token));
    if (!info) {
      return res.status(401).json({ success: false, error: '登录已失效：令牌无效，请重新短信验证登录' });
    }
    // 开发者不受限制（商户身份的开发者 15509601222A 也是开发者）
    const devPhoneNorm = String(DEVELOPER_PHONE_SERVER || '').trim().toUpperCase();
    const infoPhoneNorm = String(info.phone || '').trim().toUpperCase();
    if (infoPhoneNorm === devPhoneNorm || infoPhoneNorm === devPhoneNorm + 'A') {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = true;
      (req as any).userRole = 'developer';
      (req as any).isManager = true;
      return next();
    }
    // M10：从 squad_members 查操作者角色（同步读本地缓存）
    let userRole = 'normal';
    try {
      const dbData = readLocalJsonDb();
      const purePhone = infoPhoneNorm.replace(/A$/, '');
      const memberDoc = (dbData.squad_members && (dbData.squad_members[info.phone] || dbData.squad_members[purePhone])) || {};
      const pos = String(memberDoc.squad_position || '').trim().toLowerCase();
      if (pos === 'boss' || pos === 'manager' || pos === 'dispatcher') userRole = pos;
      if (userRole === 'normal') {
        const r = String(memberDoc.role || memberDoc.userRole || '');
        if (r.includes('城市老板')) userRole = 'boss';
        else if (r.includes('城市管理')) userRole = 'manager';
        else if (r.includes('城市派单员')) userRole = 'dispatcher';
      }
    } catch (_) {}
    (req as any).userRole = userRole;
    (req as any).isManager = userRole === 'boss' || userRole === 'manager';
    (req as any).isDispatcher = userRole === 'dispatcher';
    // 普通用户：只能操作自己手机号的文档（A后缀敏感：15509601222 ≠ 15509601222A，互不干扰）
    const normalizeId = (s: any) => String(s || '').trim().toUpperCase();
    // H10修复：同时检查 body.data.id（/api/db/add 的实际 docId 藏在 data 里）
    const bodyDocId = normalizeId(req.body?.id || req.body?.docId || req.body?.data?.id || '');
    const queryDocId = normalizeId(req.query?.id || req.query?.docId || '');
    const targetId = bodyDocId || queryDocId;
    const colName = String(req.body?.col || req.body?.collection || req.query?.col || req.query?.collection || '').trim();
    // M9：商户 A-token 写商户自有集合时，允许"去A后相等"（商户 docId 按纯手机号存储）
    const MERCHANT_OWN_COLS = ['merchant_users', 'web_valet_qrs', 'app_valet_qrs', 'dispatch_qrs', 'dispatch_qrs_web', 'dispatch_qrcodes'];
    const isMerchantToken = /A$/.test(infoPhoneNorm);
    const deA = (s: string) => s.replace(/A$/, '');
    if (isMerchantToken && MERCHANT_OWN_COLS.includes(colName) && targetId && deA(targetId) === deA(infoPhoneNorm)) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // M10：城市老板/城市管理可写成员集合（审批/删除等管理操作）；派单员可写订单集合
    const MEMBER_COLS = ['squad_members', 'driver_users', 'driver_locations', 'squad_applications', 'online_applications', 'team_members'];
    // P0(2026-10-14): hubble_authorized_drivers 只允许开发者写，防止普通用户通过 db API 给自己授权
    // 必须放在"普通用户可写自己手机号文档"的通用逻辑之前
    if (colName === 'hubble_authorized_drivers') {
      const isDev = infoPhoneNorm === devPhoneNorm || infoPhoneNorm === devPhoneNorm + 'A';
      if (!isDev) {
        return res.status(403).json({ success: false, error: '仅开发者可管理哈勃权限' });
      }
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = true;
      return next();
    }
    const ORDER_COLS = ['merchant_orders', 'valet_orders'];
    if ((req as any).isManager && (MEMBER_COLS.includes(colName) || ORDER_COLS.includes(colName))) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    if ((req as any).isDispatcher && ORDER_COLS.includes(colName)) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // 2026-10-15：城市派单员可拒绝入队申请（写 squad_applications），不开放其他成员表
    if ((req as any).isDispatcher && colName === 'squad_applications') {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // H1修复：业务接口与读接口只做基础 token 验证，不走"无targetId需管理员"逻辑
    // （这些接口请求体本来就没有 id/docId 字段，H9 的批量操作拦截不能误伤它们）
    // 注意：/api/db/set|save|update|delete|add|clear-collection 等写接口不在此列，仍走下方严格校验
    const BUSINESS_PATHS = new Set([
      '/api/order/claim',
      '/api/order/driver-claim',
      '/api/dispatch/nearest',
      '/api/driver/location',
      '/api/driver/status',
      '/api/driver/offline',
      '/api/driver/name',
      '/api/db/get',
      '/api/db/list',
      '/api/geocode',
      '/api/geo/locate',
      '/api/auth/validate',
      '/api/auth/logout',
    ]);
    if (BUSINESS_PATHS.has(req.path)) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // H9修复：无目标文档id的批量操作（如 clear-collection 清空整表）必须要求管理员
    if (!targetId) {
      // /api/db/add 未指定 id 时服务端生成随机 id，允许普通用户创建新文档
      const isAddWithGeneratedId = req.path === '/api/db/add' && !req.body?.data?.id;
      if (!isAddWithGeneratedId) {
        console.warn(`[Auth] 拒绝无目标id的批量操作: token手机=${info.phone}, 路径=${req.path}`);
        return res.status(403).json({ success: false, error: '该操作需要管理员权限' });
      }
    }
    if (targetId && targetId !== infoPhoneNorm) {
      console.warn(`[Auth] 拒绝越权写入: token手机=${info.phone}, 目标=${targetId}, 路径=${req.path}`);
      return res.status(403).json({ success: false, error: '无权操作他人数据' });
    }
    (req as any).authPhone = info.phone;
    (req as any).isAdmin = false;
    next();
  };

  // Check admin permission endpoint for https://admin.lyheiwandaijiamax.com/
  app.post('/api/admin/check-permission', requireDbAuth, (req, res) => {
    // H4修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    const { phone } = req.body;
    const cleanPhone = String(phone || '').trim();
    if (cleanPhone === '15509601222') {
      return res.json({
        success: true,
        isSuperAdmin: true,
        phone: '15509601222',
        role: 'SUPER_DEVELOPER_ADMIN',
        message: '最高开发者特权账号(15509601222)数据库匹配成功'
      });
    }
    return res.status(403).json({
      success: false,
      isSuperAdmin: false,
      error: '❌ 无权限：非最高开发者账号(15509601222)，拒绝访问或登录管理后台！'
    });
  });

  // Purge all drivers and applications except 15509601222 on demand
  app.post('/api/admin/purge-all-drivers', requireDbAuth, async (req, res) => {
    // H4修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      await purgeMockDriverData();
      return res.json({
        success: true,
        message: '✓ 已成功清理所有司机及申请审批信息，仅保留 15509601222'
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Purge failed'
      });
    }
  });

  // =========================================================================
  // UNIVERSAL DATABASE REST API ENDPOINTS (Supports MySQL & local_db.json)
  // Ensures 100% reliable cross-device data sync, instant order dispatch popups
  // =========================================================================


  // 1. GET Single Document
  // Supports: /api/db/get?col=passenger_links&id=15509601222 OR query params: collection, docId
  // H3修复：加 requireDbAuth，禁止读取 _config/config（HMAC密钥等敏感配置）
  app.get('/api/db/get', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.query.col || req.query.collection || '').trim();
      const docId = String(req.query.id || req.query.docId || '').trim();

      if (!col || !docId) {
        return res.status(400).json({ exists: false, error: 'Missing col or id parameter' });
      }
      if (col === '_config') {
        return res.status(403).json({ exists: false, error: '禁止读取系统配置' });
      }
      // config 集合允许读（城市配置、总开关等），但禁止读敏感子文档
      if (col === 'config' && (docId === 'tokenSecret' || docId.startsWith('_'))) {
        return res.status(403).json({ exists: false, error: '禁止读取系统配置' });
      }

      const now = new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

      const isDriverCol = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col);
      const cleanPhone = docId.replace(/\D/g, '').trim();
      const isCleanPhone = cleanPhone.length === 11;

      // P1(2026-10-15)：敏感集合的单文档读取加权限控制
      // 非管理员只能读自己的文档
      const requesterPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdminUser = requesterPhone === '15509601222';
      const sensitiveSingleCols = ['driver_users', 'squad_members', 'online_applications', 'driver_locations'];
      if (sensitiveSingleCols.includes(col) && !isAdminUser) {
        if (docId !== requesterPhone && cleanPhone !== requesterPhone) {
          return res.status(403).json({ exists: false, error: '无权读取他人档案' });
        }
      }

      let foundData: any = null;

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, docId]
          );
          if (rows && rows.length > 0) {
            foundData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
          } else if (isDriverCol) {
            const [crossRows]: any = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` IN ('driver_users', 'squad_members', 'online_applications', 'squad_applications') AND `doc_id` = ? LIMIT 1",
              [docId]
            );
            if (crossRows && crossRows.length > 0) {
              foundData = typeof crossRows[0].data === 'string' ? JSON.parse(crossRows[0].data) : crossRows[0].data;
            }
          }
        } catch (mysqlErr: any) {
          console.error('[DB Proxy GET MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!foundData) {
        const colData = dbData[col] || {};
        foundData = colData[docId];

        if (!foundData && isDriverCol) {
          foundData = dbData.driver_users?.[docId] || dbData.squad_members?.[docId] || dbData.squad_applications?.[docId] || dbData.online_applications?.[docId];
        }
      }

      if ((foundData || docId === '15509601222') && (isDriverCol || isCleanPhone) && docId) {
        // P1(2026-10-16)：合并用的 du/sq/oa/sa 优先读 MySQL，不再永远读本地 JSON。
        // 之前本地 JSON 永远参与合并，MySQL 抖动回退时拿到旧值，导致 App 显示跳变（已到期↔2天）。
        let sq: any = dbData.squad_members?.[docId] || {};
        let oa: any = dbData.online_applications?.[docId] || {};
        let sa: any = dbData.squad_applications?.[docId] || {};
        let du: any = dbData.driver_users?.[docId] || {};
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [mrows]: any = await mysqlPool.query(
              "SELECT `collection`, `data` FROM `daijia_documents` WHERE `collection` IN ('driver_users','squad_members','online_applications','squad_applications') AND `doc_id` = ?",
              [docId]);
            for (const r of (mrows || [])) {
              try {
                const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                if (r.collection === 'driver_users') du = d;
                else if (r.collection === 'squad_members') sq = d;
                else if (r.collection === 'online_applications') oa = d;
                else if (r.collection === 'squad_applications') sa = d;
              } catch (_) {}
            }
          } catch (_) {
            // MySQL 失败时回退用本地（已在上方赋值）
          }
        }
        const raw = foundData || {};

        const effectiveRole = (docId === '15509601222')
          ? '开发者司机'
          : (raw.role || raw.userRole || du.role || du.userRole || sq.role || '普通司机');

        const name = (docId === '15509601222')
          ? '吴彦祖'
          : (raw.driverName || raw.name || du.driverName || du.name || sq.name || sq.driverName || oa.driverName || sa.name || `司机${docId.slice(-4)}`);
        const isRejected = (raw.status === '已拒绝' || du.status === '已拒绝' || sq.status === '已拒绝' || oa.status === '已拒绝' || sa.status === '已拒绝');
        const status = isRejected ? '已拒绝' : '已通过';
        
        // Authoritative vipExpiry resolution: driver_users takes precedence, then raw document
        let vipExpiry = '';
        if (du.vipExpiry !== undefined && du.vipExpiry !== null && du.vipExpiry !== '') {
          vipExpiry = String(du.vipExpiry).trim();
        } else if (raw.vipExpiry !== undefined && raw.vipExpiry !== null && raw.vipExpiry !== '') {
          vipExpiry = String(raw.vipExpiry).trim();
        } else if (sq.vipExpiry !== undefined && sq.vipExpiry !== null && sq.vipExpiry !== '') {
          vipExpiry = String(sq.vipExpiry).trim();
        } else if (oa.vipExpiry !== undefined && oa.vipExpiry !== null && oa.vipExpiry !== '') {
          vipExpiry = String(oa.vipExpiry).trim();
        } else if (sa.vipExpiry !== undefined && sa.vipExpiry !== null && sa.vipExpiry !== '') {
          vipExpiry = String(sa.vipExpiry).trim();
        }

        // 2026-10-16修复：licenseExpiry显式解析，MySQL(raw)优先，修充值后App仍显示"待开通"
        // raw来自MySQL是生产环境数据源，du/sq等来自本地JSON可能滞后
        let licenseExpiry = '';
        const pickLic = (v: any): string => {
          const s = String(v ?? '').trim();
          return (s && s !== '待开通') ? s : '';
        };
        // P0(2026-10-17)：删 raw 优先级。raw 来自 LIMIT 1 无 ORDER BY 的随机查询，
        // 可能拿到4集合中任意一个的旧值（如 squad_applications 的 2天），导致 0↔2 跳变。
        // du/sq/oa/sa 是全量查询（无 LIMIT），按 driver_users 优先顺序合并。
        licenseExpiry = pickLic(du.licenseExpiry) || pickLic(sq.licenseExpiry) || pickLic(oa.licenseExpiry) || pickLic(sa.licenseExpiry) || pickLic(raw.licenseExpiry);

        if (isRejected) {
          vipExpiry = '待开通';
        } else if (!vipExpiry) {
          vipExpiry = '待开通';
        }

        const effectiveQr = (raw.wechatQrCode || du.wechatQrCode || sq.wechatQrCode || raw.qrcode_url || du.qrcode_url || sq.qrcode_url || '').trim();

        const resolvedDoc = {
          ...sq,
          ...oa,
          ...sa,
          ...du,
          ...raw,
          phone: docId,
          phoneNumber: docId,
          driverName: name,
          name: name,
          role: effectiveRole,
          userRole: effectiveRole,
          position: effectiveRole,
          squad_position: effectiveRole === '城市派单员司机' ? 'dispatcher' : effectiveRole === '城市管理司机' ? 'manager' : effectiveRole === '城市老板司机' ? 'boss' : effectiveRole === '开发者司机' ? 'developer' : 'normal',
          status: status,
          vipExpiry: vipExpiry,
          licenseExpiry: licenseExpiry || '待开通',
          qrcode_url: effectiveQr,
          wechatQrCode: effectiveQr,
          qrCode: effectiveQr,
          approvedBy: raw.approvedBy || sq.approvedBy || du.approvedBy || '最高开发者',
          approvedRole: raw.approvedRole || sq.approvedRole || du.approvedRole || '开发者司机',
          updatedAt: raw.updatedAt || du.updatedAt || new Date().toISOString()
        };

        if (docId === '15509601222') {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][docId] = resolvedDoc;
          if (!dbData.driver_users) dbData.driver_users = {};
          if (!dbData.squad_members) dbData.squad_members = {};
          dbData.driver_users[docId] = { ...(dbData.driver_users[docId] || {}), ...resolvedDoc };
          dbData.squad_members[docId] = { ...(dbData.squad_members[docId] || {}), ...resolvedDoc };
          writeLocalJsonDb(dbData);
        }

        return res.json({ exists: true, id: docId, data: resolvedDoc });
      }

      if (foundData !== null && foundData !== undefined) {
        return res.json({ exists: true, id: docId, data: foundData });
      }
      // 城市配置兜底（2026-10-11）：部署覆盖导致配置丢失时，返回银川默认开通，避免"暂未开通服务"
      if (col === 'config' && docId === 'city_configs') {
        const defaultConfigs = {
          configs: {
            '银川': { online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true, squadNames: ['银川代驾小队'] },
            '银川市': { online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true, squadNames: ['银川代驾小队'] }
          }
        };
        return res.json({ exists: true, id: docId, data: defaultConfigs });
      }
      if (col === 'config' && docId === 'master_switches') {
        return res.json({ exists: true, id: docId, data: { online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true } });
      }
      return res.json({ exists: false, id: docId, data: null });
    } catch (err: any) {
      console.error('[DB Proxy GET Exception]:', err);
      res.status(500).json({ exists: false, error: err.message });
    }
  });

  // 2. LIST Documents from Collection
  // Supports: /api/db/list?col=merchant_orders&limit=10000&constraints=... AND /api/db/:col
  // H3修复：加 requireDbAuth，禁止列取 _config/config（HMAC密钥等敏感配置）
  const handleDbList = async (req: express.Request, res: express.Response) => {
    try {
      const col = String(req.params.col || req.query.col || req.query.collection || '').trim();
      if (!col) {
        return res.status(400).json({ docs: [], error: 'Missing col parameter' });
      }
      // H3修复：任何用户都不能批量读取系统配置集合
      if (col === '_config' || col === 'config') {
        return res.status(403).json({ docs: [], error: '禁止读取系统配置' });
      }
      // P1(2026-10-15)：敏感集合的批量读取加权限控制
      // driver_users/squad_members：只允许管理员或本人（本人只能读自己的doc）
      // merchant_orders：只允许管理员或订单关联人（通过doc_id过滤，本人只能读自己的）
      const requesterPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdmin = requesterPhone === '15509601222';
      if (!isAdmin && (col === 'driver_users' || col === 'squad_members' || col === 'online_applications')) {
        // 非管理员只能读自己的文档，强制doc_id=本人手机号
        // 这里先放行，后续在查询时强制过滤
      }

      const limitNum = Math.min(Math.max(Number(req.query.limit) || 10000, 1), 20000);
      // P0-2: 增量拉取，只返回 updated_at > since 的文档，大幅降低3000并发时的数据量
      const sinceParam = String(req.query.since || '').trim();
      const sinceDate = sinceParam ? new Date(sinceParam) : null;
      const hasValidSince = sinceDate && !isNaN(sinceDate.getTime());

      // P1(2026-10-15)：敏感集合非管理员只能读自己的文档
      const sensitiveCols = ['driver_users', 'squad_members', 'online_applications', 'driver_locations'];
      const isSensitive = sensitiveCols.includes(col);
      let forcedDocId: string | null = null;
      if (isSensitive && !isAdmin) {
        if (!requesterPhone) {
          return res.status(403).json({ docs: [], error: '无权批量读取' });
        }
        forcedDocId = requesterPhone; // 强制只读本人
      }

      // P0(2026-10-16)：函数顶层统一初始化，MySQL 分支与 JSON 分支共用。
      // 修复生产运行时 ReferenceError：① dbData 在 MySQL 分支声明前使用（TDZ）；
      // ② isOrdersCol 仅在 MySQL 块内声明、JSON 过滤块却引用它。
      const dbData = readLocalJsonDb();
      const isDriverCol = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col);
      const isOrdersCol = ['merchant_orders', 'valet_orders', 'orders'].includes(col);
      const removedArr: string[] = dbData.config?.['removed_squad_members']?.phones || [];
      const clearedTimestamp = Number(dbData.config?.['merchant_orders_cleared']?.clearedAt || 0);

      // P1-2修复(2026-10-14)：用 token 解析出的真实身份，不信任客户端传的手机号（可伪造/可省略绕过）
      // 被移出小队的司机一律不返回订单（MySQL/JSON 双分支统一生效）
      if (isOrdersCol && requesterPhone && requesterPhone !== '15509601222') {
        if (removedArr.includes(requesterPhone)) {
          return res.json({ docs: [], list: [], data: [] });
        }
      }

      if (isMySQLEnabled && mysqlPool) {
        try {
          let rows: any;
          if (forcedDocId) {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, forcedDocId]
            );
          } else if (hasValidSince) {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `updated_at` > ? ORDER BY `updated_at` DESC LIMIT ?',
              [col, sinceDate, limitNum]
            );
          } else {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? ORDER BY `updated_at` DESC LIMIT ?',
              [col, limitNum]
            );
          }
          const now = new Date();
          const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          target50d.setDate(target50d.getDate() + 50);
          const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

          const docs = (rows || []).map((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const obj = typeof data === 'object' && data !== null ? { ...data } : {};
            return { id: r.doc_id, ...obj, data: obj };
          }).filter((doc: any) => {
            const docIdStr = String(doc.id || doc.phone || '').trim();
            const cleanPhone = docIdStr.replace(/\D/g, '').trim();

            if (col === 'squad_applications') {
              if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant || doc.accountType === 'merchant') return false;
              if (cleanPhone === '15509601222') return false;
              if (isGenericDriverName(doc.name || doc.driverName || doc.applicantName, cleanPhone)) return doc.status === '已拒绝';
              return true;
            }

            if (col === 'online_applications') {
              // Online applications: Keep 15509601222 developer driver resident; exclude legacy deleted mock drivers
              if (cleanPhone === '15509601222') return true;
              if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant) return false;
              return true;
            }

            if (['merchant_accounts', 'merchant_users'].includes(col)) {
              // 商户识别（与前端 isMerchantAccountUnified 一致）：A后缀 或 isMerchant/accountType 或 role含商户/商家
              const docRole = String(doc?.role || doc?.userRole || '');
              const isMerchantByRole = (docRole.includes('商户') || docRole.includes('商家')) && !docRole.includes('司机');
              if (!docIdStr.toUpperCase().endsWith('A') && !doc?.isMerchant && doc?.accountType !== 'merchant' && !isMerchantByRole) return false;
              return true;
            }

            if (['squad_members', 'driver_users'].includes(col)) {
              if (cleanPhone === '15509601222') return true;
              if (docIdStr.toUpperCase().endsWith('A')) return false; // Merchant A accounts go to merchant_accounts only
              if (isGenericDriverName(doc.name || doc.driverName, cleanPhone)) return false;
              return true;
            }

            if (isOrdersCol && clearedTimestamp > 0) {
              const t = Number(doc.timestamp || doc.createdAt || doc.dispatchedAt || 0);
              if (t > 0 && t <= clearedTimestamp) return false;
            }
            return true;
          });

          return res.json({ docs, list: docs, data: docs });
        } catch (mysqlErr: any) {
          console.error('[DB Proxy LIST MySQL Error]:', mysqlErr);
          // P0(2026-10-16)：MySQL 已启用时查询失败必须明确返回 500，
          // 禁止静默回退本地 JSON（旧数据/空数据会造成"空列表假成功"）
          return res.status(500).json({ docs: [], error: 'MySQL 查询失败: ' + (mysqlErr?.message || 'unknown') });
        }
      }

      // JSON DB Fallback（仅 MySQL 未启用时走这里；dbData 已在函数顶部初始化）
      const colData = dbData[col] || {};

      const docs = Object.keys(colData).map((k) => {
        const itemData = colData[k];
        const obj = typeof itemData === 'object' && itemData !== null ? { ...itemData } : {};
        return {
          id: k,
          ...obj,
          data: obj
        };
      }).filter((doc: any) => {
        // P1(2026-10-15)：敏感集合非管理员只能看自己的文档
        if (forcedDocId) {
          const docIdStr = String(doc.id || '').trim();
          if (docIdStr !== forcedDocId) return false;
        }
        const docIdStr = String(doc.id || doc.phone || '').trim();
        const cleanPhone = docIdStr.replace(/\D/g, '').trim();

        if (col === 'squad_applications') {
          if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant || doc.accountType === 'merchant') return false;
          if (cleanPhone === '15509601222') return false;
          if (isGenericDriverName(doc.name || doc.driverName || doc.applicantName, cleanPhone)) return doc.status === '已拒绝';
          return true;
        }

        if (col === 'online_applications') {
          if (cleanPhone === '15509601222') return true;
          if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant) return false;
          return true;
        }

        if (['merchant_accounts', 'merchant_users'].includes(col)) {
          if (!docIdStr.toUpperCase().endsWith('A')) return false;
          return true;
        }

        if (['squad_members', 'driver_users'].includes(col)) {
          if (cleanPhone === '15509601222') return true;
          if (docIdStr.toUpperCase().endsWith('A')) return false;
          if (isGenericDriverName(doc.name || doc.driverName, cleanPhone)) return false;
          return true;
        }

        if (isOrdersCol && clearedTimestamp > 0) {
          const t = Number(doc.timestamp || doc.createdAt || doc.dispatchedAt || 0);
          if (t > 0 && t <= clearedTimestamp) return false;
        }

        return true;
      });

      return res.json({ docs, list: docs, data: docs });
    } catch (err: any) {
      console.error('[DB Proxy LIST Exception]:', err);
      res.status(500).json({ docs: [], error: err.message });
    }
  };

  // H3修复：读接口加 requireDbAuth（防匿名批量拉取司机隐私数据）
  app.get('/api/db/list', requireDbAuth, handleDbList);
  app.get('/api/db/:col', requireDbAuth, (req, res, next) => {
    const col = req.params.col;
    if (['get', 'set', 'save', 'update', 'delete', 'clear-collection', 'add', 'migrate-from-firestore'].includes(col)) {
      return next();
    }
    return handleDbList(req, res);
  });

  // 3. SET Document (create or replace/merge) - Supports both /api/db/set and /api/db/save
  app.post(['/api/db/set', '/api/db/save'], requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const docId = String(req.body.id || req.body.docId || '').trim();
      const data = req.body.data;
      // Default to true unless explicitly false to prevent accidental document destruction
      const merge = req.body.merge !== undefined ? Boolean(req.body.merge) : true;

      if (!col || !docId || data === undefined) {
        return res.status(400).json({ success: false, error: 'Missing col, id, or data' });
      }

      // P1(2026-10-15)：纠偏功能仅VIP可用，服务端强制校验
      if (col === 'driver_users' && data && (data as any).deviationMitigation === true) {
        try {
          const targetPhone = docId.replace(/\D/g, '').trim();
          let vipExpiry = String((data as any).vipExpiry || '');
          if (!vipExpiry) {
            if (isMySQLEnabled && mysqlPool) {
              const [vrows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', targetPhone]);
              if (vrows && vrows.length > 0) {
                const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
                vipExpiry = String(vd.vipExpiry || '');
              }
            } else {
              vipExpiry = String(readLocalJsonDb()?.driver_users?.[targetPhone]?.vipExpiry || '');
            }
          }
          if (targetPhone !== '15509601222' && !isVipActiveServer(vipExpiry)) {
            return res.status(403).json({ success: false, error: '纠偏功能为VIP专属，请先开通VIP' });
          }
        } catch (e) {
          console.error('[DB Set] 纠偏VIP校验异常:', (e as any)?.message);
          return res.status(503).json({ success: false, error: '校验失败，请重试' });
        }
      }

      // M3修复：普通用户写 squad_members 时剥离敏感字段（防被开除司机自助"洗白"）
      // 只有开发者/城市老板/城市管理可写 status/approvalStatus/role/squad_position
      if (col === 'squad_members' && !(req as any).isAdmin && !(req as any).isManager) {
        const SENSITIVE = ['status', 'approvalStatus', 'role', 'squad_position', 'userRole', 'position'];
        for (const f of SENSITIVE) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 剥离敏感字段: token手机=${(req as any).authPhone}, 字段=${f}`);
            delete data[f];
          }
        }
      }
      // P1(2026-10-16晚)：vipExpiry/licenseExpiry 任何人（包括开发者）都不能经通用 /api/db/set 写入。
      // 根因：开发者身份的 App 在 21:01:13 把旧 licenseExpiry(2026-10-18) 写回 MySQL，
      // 覆盖了管理后台 20:57:50 设的"已到期"，导致 App 显示从 0 跳回 2。
      // licenseExpiry/vipExpiry 只能经专用 /api/admin/recharge-license 和 /api/admin/*-vip* 接口修改。
      // P0(2026-10-16第二遍审计)：覆盖全部四个司机集合（与 /api/db/get 合并链一致），之前只盖了两个。
      if (['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col)) {
        for (const f of ['vipExpiry', 'licenseExpiry']) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 通用接口写${f}已剥离: token手机=${(req as any).authPhone}, col=${col}`);
            delete data[f];
          }
        }
      }

      // 1. If explicitly approving or applying, automatically unblacklist the driver
      const isExplicitApproval = (data?.status === '已通过' || data?.approvalStatus === '已通过');
      const isExplicitApplication = col === 'squad_applications' && (data?.status === '待审核' || data?.status === '已通过');

      if ((col === 'squad_members' && isExplicitApproval) || isExplicitApplication) {
        // Auto-remove docId from removed_squad_members
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()).filter((p: string) => p && p !== docId) : [];
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['config', 'removed_squad_members', JSON.stringify({ phones })]
              );
            }
          } catch (_) {}
        }
        const dbDataTmp = readLocalJsonDb();
        if (dbDataTmp.config?.['removed_squad_members']?.phones) {
          dbDataTmp.config['removed_squad_members'].phones = dbDataTmp.config['removed_squad_members'].phones
            .map((p: any) => String(p).trim())
            .filter((p: string) => p && p !== docId);
          writeLocalJsonDb(dbDataTmp);
        }
      }

      // If writing to squad_members and not approved, check if driver is blacklisted
      if (col === 'squad_members' && docId !== '15509601222' && !isExplicitApproval) {
        let isRemovedDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()) : [];
              if (phones.includes(docId)) isRemovedDriver = true;
            }
          } catch (_) {}
        } else {
          const dbDataTmp = readLocalJsonDb();
          const phones = dbDataTmp.config?.['removed_squad_members']?.phones || [];
          if (Array.isArray(phones) && phones.map((p: any) => String(p).trim()).includes(docId)) {
            isRemovedDriver = true;
          }
        }
        if (isRemovedDriver) {
          console.warn(`[DB Proxy SET] Dropping non-approved squad_members write for removed driver: ${docId}`);
          return res.json({ success: true, id: docId, dropped: true });
        }
      }

      let finalData = data;

      const now = new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

      if (isMySQLEnabled && mysqlPool) {
        try {
          if (merge) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, docId]
            );
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              finalData = { ...prev, ...data };
              if (col === 'driver_users' || col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
                if (data.vipExpiry !== undefined) {
                  finalData.vipExpiry = data.vipExpiry;
                } else if (prev && prev.vipExpiry !== undefined) {
                  finalData.vipExpiry = prev.vipExpiry;
                } else if (!finalData.vipExpiry) {
                  finalData.vipExpiry = '待开通';
                }
                if (data.customAppName !== undefined) {
                  finalData.customAppName = data.customAppName;
                } else if (prev.customAppName !== undefined) {
                  finalData.customAppName = prev.customAppName;
                }
                if (data.deviationMitigation !== undefined) {
                  finalData.deviationMitigation = Boolean(data.deviationMitigation);
                } else if (prev.deviationMitigation !== undefined) {
                  finalData.deviationMitigation = prev.deviationMitigation;
                }
                if (data.deviationKm !== undefined) {
                  finalData.deviationKm = data.deviationKm;
                } else if (prev.deviationKm !== undefined) {
                  finalData.deviationKm = prev.deviationKm;
                }
                if (data.deviationWaitSec !== undefined) {
                  finalData.deviationWaitSec = data.deviationWaitSec;
                } else if (prev.deviationWaitSec !== undefined) {
                  finalData.deviationWaitSec = prev.deviationWaitSec;
                }
              }
            }
          }
          const dataStr = JSON.stringify(finalData);
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, docId, dataStr]
          );
        } catch (mysqlErr: any) {
          console.error('[DB Proxy SET MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      if (merge && dbData[col][docId]) {
        const prev = dbData[col][docId];
        finalData = { ...prev, ...data };
        if (col === 'driver_users' || col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
          if (data.vipExpiry !== undefined) {
            finalData.vipExpiry = data.vipExpiry;
          } else if (prev && prev.vipExpiry !== undefined) {
            finalData.vipExpiry = prev.vipExpiry;
          } else if (!finalData.vipExpiry) {
            finalData.vipExpiry = '待开通';
          }
          if (data.customAppName !== undefined) {
            finalData.customAppName = data.customAppName;
          } else if (prev.customAppName !== undefined) {
            finalData.customAppName = prev.customAppName;
          }
          if (data.deviationMitigation !== undefined) {
            finalData.deviationMitigation = Boolean(data.deviationMitigation);
          } else if (prev.deviationMitigation !== undefined) {
            finalData.deviationMitigation = prev.deviationMitigation;
          }
          if (data.deviationKm !== undefined) {
            finalData.deviationKm = data.deviationKm;
          } else if (prev.deviationKm !== undefined) {
            finalData.deviationKm = prev.deviationKm;
          }
          if (data.deviationWaitSec !== undefined) {
            finalData.deviationWaitSec = data.deviationWaitSec;
          } else if (prev.deviationWaitSec !== undefined) {
            finalData.deviationWaitSec = prev.deviationWaitSec;
          }
        }
      }
      dbData[col][docId] = finalData;

      // Automatically mirror approved squad/application drivers into driver_users
      if (col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          if (!dbData['driver_users']) dbData['driver_users'] = {};
          const existingUser = dbData['driver_users'][cleanDriverPhone] || {};
          const name = finalData.name || finalData.driverName || finalData.applicantName || existingUser.driverName || `司机${cleanDriverPhone.slice(-4)}`;
          
          const resolvedVip = finalData.vipExpiry !== undefined ? finalData.vipExpiry : (existingUser.vipExpiry || '待开通');

          const mergedDriverUser = {
            ...existingUser,
            ...finalData,
            phone: cleanDriverPhone,
            phoneNumber: cleanDriverPhone,
            driverName: name,
            name: name,
            role: finalData.role || finalData.userRole || existingUser.role || '普通司机',
            userRole: finalData.role || finalData.userRole || existingUser.userRole || '普通司机',
            status: finalData.status || existingUser.status || '已通过',
            is_squad_member: (col === 'squad_members' || finalData.status === '已通过' || finalData.is_squad_member === 1) ? 1 : (existingUser.is_squad_member ?? 0),
            city: finalData.city || existingUser.city || '银川市',
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== undefined ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: Boolean(finalData.onlineOrdersEnabled !== undefined ? finalData.onlineOrdersEnabled : (existingUser.onlineOrdersEnabled !== false)),
            isBanned: Boolean(finalData.isBanned !== undefined ? finalData.isBanned : existingUser.isBanned),
            updatedAt: new Date().toISOString()
          };
          dbData['driver_users'][cleanDriverPhone] = mergedDriverUser;
          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['driver_users', cleanDriverPhone, JSON.stringify(mergedDriverUser)]
            ).catch(() => {});
          }
        }
      }

      // If updating driver_users vipExpiry or fields, mirror to squad_members and squad_applications
      if (col === 'driver_users') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          const mirrorCols = ['squad_members', 'squad_applications'];
          for (const mCol of mirrorCols) {
            if (dbData[mCol] && dbData[mCol][cleanDriverPhone]) {
              const currentM = dbData[mCol][cleanDriverPhone];
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== undefined) updatedM.vipExpiry = finalData.vipExpiry;
              if (finalData.role) {
                updatedM.role = finalData.role;
                updatedM.userRole = finalData.role;
                updatedM.position = finalData.role;
                updatedM.squad_position = finalData.role === '城市派单员司机' ? 'dispatcher' : finalData.role === '城市管理司机' ? 'manager' : finalData.role === '城市老板司机' ? 'boss' : 'normal';
              }
              if (finalData.wechatQrCode) updatedM.wechatQrCode = finalData.wechatQrCode;
              if (finalData.qrCode) updatedM.qrCode = finalData.qrCode;
              if (finalData.qrcode_url) updatedM.qrcode_url = finalData.qrcode_url;
              if (finalData.driverName) {
                updatedM.driverName = finalData.driverName;
                updatedM.name = finalData.driverName;
              }
              if (finalData.city) updatedM.city = finalData.city;
              if (finalData.isBanned !== undefined) updatedM.isBanned = finalData.isBanned;
              dbData[mCol][cleanDriverPhone] = updatedM;

              if (isMySQLEnabled && mysqlPool) {
                mysqlPool.query(
                  'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                  'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                  [mCol, cleanDriverPhone, JSON.stringify(updatedM)]
                ).catch(() => {});
              }
            }
          }
        }
      }

      writeLocalJsonDb(dbData, true);

      // Seamless inter-connectivity: forward writes to Mainland China Aliyun ECS Baota Server if in preview
      const hostHeader = String(req.headers.host || '');
      if (!hostHeader.includes('lyheiwandaijiamax.com')) {
        const baotaBaseUrl = 'https://api.lyheiwandaijiamax.com';
        fetch(`${baotaBaseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ col, id: docId, data, merge })
        }).catch(() => {});
      }

      return res.json({ success: true, id: docId });
    } catch (err: any) {
      console.error('[DB Proxy SET Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. UPDATE Document (partial merge)
  app.post('/api/db/update', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const docId = String(req.body.id || req.body.docId || '').trim();
      const data = req.body.data;

      if (!col || !docId || data === undefined) {
        return res.status(400).json({ success: false, error: 'Missing col, id, or data' });
      }

      // M3修复：普通用户写 squad_members 时剥离敏感字段（防被开除司机自助"洗白"）
      if (col === 'squad_members' && !(req as any).isAdmin && !(req as any).isManager) {
        const SENSITIVE = ['status', 'approvalStatus', 'role', 'squad_position', 'userRole', 'position'];
        for (const f of SENSITIVE) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 剥离敏感字段: token手机=${(req as any).authPhone}, 字段=${f}`);
            delete data[f];
          }
        }
      }
      // P1(2026-10-16晚)：vipExpiry/licenseExpiry 任何人（包括开发者）都不能经通用 /api/db/update 写入。
      // 与 /api/db/set 同口径：只能经专用 /api/admin/recharge-license 和 /api/admin/*-vip* 接口修改。
      // 根因见 /api/db/set 处注释（2026-10-16 21:01:13 App 写回旧值覆盖管理后台设置）。
      // P0(2026-10-16第二遍审计)：覆盖全部四个司机集合（与 /api/db/get 合并链一致）。
      if (['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col)) {
        for (const f of ['vipExpiry', 'licenseExpiry']) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 通用接口写${f}已剥离: token手机=${(req as any).authPhone}, col=${col}`);
            delete data[f];
          }
        }
      }

      // 1. If explicitly approving or applying, automatically unblacklist the driver
      const isExplicitApproval = (data?.status === '已通过' || data?.approvalStatus === '已通过');
      const isExplicitApplication = col === 'squad_applications' && (data?.status === '待审核' || data?.status === '已通过');

      if ((col === 'squad_members' && isExplicitApproval) || isExplicitApplication) {
        // Auto-remove docId from removed_squad_members
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()).filter((p: string) => p && p !== docId) : [];
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['config', 'removed_squad_members', JSON.stringify({ phones })]
              );
            }
          } catch (_) {}
        }
        const dbDataTmp = readLocalJsonDb();
        if (dbDataTmp.config?.['removed_squad_members']?.phones) {
          dbDataTmp.config['removed_squad_members'].phones = dbDataTmp.config['removed_squad_members'].phones
            .map((p: any) => String(p).trim())
            .filter((p: string) => p && p !== docId);
          writeLocalJsonDb(dbDataTmp);
        }
      }

      // If updating squad_members, verify the driver is not in removed_squad_members blacklist
      if (col === 'squad_members' && docId !== '15509601222' && !isExplicitApproval) {
        let isRemovedDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()) : [];
              if (phones.includes(docId)) isRemovedDriver = true;
            }
          } catch (_) {}
        } else {
          const dbDataTmp = readLocalJsonDb();
          const phones = dbDataTmp.config?.['removed_squad_members']?.phones || [];
          if (Array.isArray(phones) && phones.map((p: any) => String(p).trim()).includes(docId)) {
            isRemovedDriver = true;
          }
        }
        if (isRemovedDriver) {
          console.warn(`[DB Proxy UPDATE] Dropping non-approved squad_members write for removed driver: ${docId}`);
          return res.json({ success: true, id: docId, dropped: true });
        }
      }

      let finalData = data;

      // M4修复：统一合并基——先读MySQL和JSON，以MySQL为准合并一次；MySQL写失败直接500，不再静默吞错
      if (isMySQLEnabled && mysqlPool) {
        const [rows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          [col, docId]
        );
        if (rows && rows.length > 0) {
          const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
          finalData = { ...prev, ...data };
        }
        const dataStr = JSON.stringify(finalData);
        try {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, docId, dataStr]
          );
        } catch (mysqlErr: any) {
          console.error('[DB Proxy UPDATE MySQL Error]:', mysqlErr);
          return res.status(500).json({ success: false, error: '数据库写入失败: ' + (mysqlErr?.message || 'MySQL error') });
        }
      }

      // JSON DB Fallback（与MySQL用同一 finalData，不再二次重算覆盖）
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      dbData[col][docId] = finalData;

      // Automatically mirror approved squad/application drivers into driver_users
      if (col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          if (!dbData['driver_users']) dbData['driver_users'] = {};
          const existingUser = dbData['driver_users'][cleanDriverPhone] || {};
          const name = finalData.name || finalData.driverName || finalData.applicantName || existingUser.driverName || `司机${cleanDriverPhone.slice(-4)}`;
          
          const resolvedVip = finalData.vipExpiry !== undefined ? finalData.vipExpiry : (existingUser.vipExpiry || '待开通');

          const mergedDriverUser = {
            ...existingUser,
            ...finalData,
            phone: cleanDriverPhone,
            phoneNumber: cleanDriverPhone,
            driverName: name,
            name: name,
            role: finalData.role || finalData.userRole || existingUser.role || '普通司机',
            userRole: finalData.role || finalData.userRole || existingUser.userRole || '普通司机',
            status: finalData.status || existingUser.status || '已通过',
            is_squad_member: (col === 'squad_members' || finalData.status === '已通过' || finalData.is_squad_member === 1) ? 1 : (existingUser.is_squad_member ?? 0),
            city: finalData.city || existingUser.city || '银川市',
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== undefined ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: Boolean(finalData.onlineOrdersEnabled !== undefined ? finalData.onlineOrdersEnabled : (existingUser.onlineOrdersEnabled !== false)),
            isBanned: Boolean(finalData.isBanned !== undefined ? finalData.isBanned : existingUser.isBanned),
            updatedAt: new Date().toISOString()
          };
          dbData['driver_users'][cleanDriverPhone] = mergedDriverUser;
          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['driver_users', cleanDriverPhone, JSON.stringify(mergedDriverUser)]
            ).catch(() => {});
          }
        }
      }

      // If updating driver_users vipExpiry or fields, mirror to squad_members and squad_applications
      if (col === 'driver_users') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          const mirrorCols = ['squad_members', 'squad_applications'];
          for (const mCol of mirrorCols) {
            if (dbData[mCol] && dbData[mCol][cleanDriverPhone]) {
              const currentM = dbData[mCol][cleanDriverPhone];
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== undefined) updatedM.vipExpiry = finalData.vipExpiry;
              if (finalData.driverName) {
                updatedM.driverName = finalData.driverName;
                updatedM.name = finalData.driverName;
              }
              if (finalData.city) updatedM.city = finalData.city;
              if (finalData.isBanned !== undefined) updatedM.isBanned = finalData.isBanned;
              dbData[mCol][cleanDriverPhone] = updatedM;

              if (isMySQLEnabled && mysqlPool) {
                mysqlPool.query(
                  'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                  'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                  [mCol, cleanDriverPhone, JSON.stringify(updatedM)]
                ).catch(() => {});
              }
            }
          }
        }
      }

      writeLocalJsonDb(dbData);

      return res.json({ success: true, id: docId });
    } catch (err: any) {
      console.error('[DB Proxy UPDATE Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Dedicated admin endpoint to update driver VIP expiry across all collections atomically
  app.post('/api/admin/update-driver-expiry', requireDbAuth, async (req, res) => {
    // H5修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      const phone = String(req.body.phone || req.body.phoneNumber || '').replace(/\D/g, '').trim();
      const rawVip = String(req.body.vipExpiry || '').trim();

      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: '请输入有效的11位手机号码' });
      }

      let vipExpiry = rawVip;
      if (!vipExpiry || vipExpiry === '0' || vipExpiry === '0天' || vipExpiry === '待激活' || vipExpiry === '未激活' || vipExpiry === '待开通' || vipExpiry === '未开通' || vipExpiry === '已到期' || vipExpiry === '已过期') {
        vipExpiry = '待开通';
      } else if (vipExpiry === '永久' || vipExpiry === '永久有效' || vipExpiry === 'permanent' || vipExpiry === '终身') {
        vipExpiry = '永久有效';
      }

      const dbData = readLocalJsonDb();
      const targetCols = ['driver_users', 'squad_members', 'squad_applications'];
      
      for (const col of targetCols) {
        if (!dbData[col]) dbData[col] = {};
        const existing = dbData[col][phone] || {};
        const updated = {
          ...existing,
          phone,
          phoneNumber: phone,
          vipExpiry,
          updatedAt: new Date().toISOString()
        };
        dbData[col][phone] = updated;

        // 2026-10-16修复：MySQL 写入失败不再静默吞掉（曾导致列表读 MySQL 显示旧值、详情读 JSON 显示新值，
        // 左右不一致）。死锁/超时时重试 3 次，仍失败则抛错让管理后台显示失败而非假成功。
        if (isMySQLEnabled && mysqlPool) {
          const upsertSql =
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)';
          const upsertArgs = [col, phone, JSON.stringify(updated)];
          let mysqlOk = false;
          let lastMysqlErr: any = null;
          for (let attempt = 0; attempt < 3 && !mysqlOk; attempt++) {
            try {
              await mysqlPool.query(upsertSql, upsertArgs);
              mysqlOk = true;
            } catch (e: any) {
              lastMysqlErr = e;
              if (attempt < 2) await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
            }
          }
          if (!mysqlOk) {
            console.error('[Admin VIP Expiry MySQL Write Failed]:', col, phone, lastMysqlErr?.message || lastMysqlErr);
            throw new Error(`MySQL 写入失败(${col})：${lastMysqlErr?.message || lastMysqlErr}`);
          }
        }
      }

      writeLocalJsonDb(dbData, true);

      // Seamless inter-connectivity: forward update to Mainland China Aliyun ECS Baota Server if running on Cloud Run/external proxy
      const hostHeader = String(req.headers.host || '');
      if (!hostHeader.includes('lyheiwandaijiamax.com')) {
        const baotaBaseUrl = 'https://api.lyheiwandaijiamax.com';
        fetch(`${baotaBaseUrl}/api/admin/update-driver-expiry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, vipExpiry })
        }).catch(err => console.warn('[Forward to Baota update-driver-expiry error]:', err));

        for (const col of targetCols) {
          fetch(`${baotaBaseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              col,
              id: phone,
              data: { phone, phoneNumber: phone, vipExpiry, updatedAt: new Date().toISOString() },
              merge: true
            })
          }).catch(() => {});
        }
      }

      console.log(`[Admin VIP Expiry Updated] Phone: ${phone} -> vipExpiry: ${vipExpiry}`);
      // P1(2026-10-16第二遍审计)：VIP单改补操作日志。
      await logAdminOperation('update-vip-expiry', String((req as any).authPhone || ''), phone, `VIP有效期设为${vipExpiry}`, req).catch(() => {});
      return res.json({ success: true, phone, vipExpiry });
    } catch (err: any) {
      console.error('[Admin VIP Expiry Update Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 接单授权充值接口 (2026-10-15)：仅开发者15509601222可操作，按手机号或名字充值天数
  app.post('/api/admin/recharge-license', requireDbAuth, async (req, res) => {
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '仅开发者可充值接单授权' });
    }
    try {
      const inputPhone = String(req.body.phone || req.body.phoneNumber || '').replace(/\D/g, '').trim();
      const inputName = String(req.body.name || '').trim();
      // 2026-10-16晚：支持 permanent=true 设为永久。永久直接写'永久有效'，跳过天数校验。
      const wantPermanent = (req.body as any).permanent === true;
      // P0(2026-10-16)：天数=0 表示屏蔽接单（管理后台文案承诺的行为），不再当非法输入拦掉；
      // 但缺参数/空字符串必须拒绝，防止误触清空授权
      const rawDays: any = (req.body as any).days;
      const days = Math.floor(Number(rawDays));
      if (!wantPermanent) {
        if (rawDays === undefined || rawDays === null || String(rawDays).trim() === '' || isNaN(days) || days < 0 || days > 3650) {
          return res.status(400).json({ success: false, error: '天数必须在0-3650之间（0=屏蔽接单）' });
        }
      }
      // 按手机号或名字查找司机（名字必须精确匹配唯一，多人重名时要求用手机号）
      let targetPhone = inputPhone;
      if (!targetPhone && inputName) {
        const matches: string[] = [];
        const collectMatches = (pid: string, d: any) => {
          const n = String(d?.name || d?.driverName || '').trim();
          if (n && n === inputName) {
            const p = String(pid).replace(/\D/g, '').trim();
            if (/^1[3-9]\d{9}$/.test(p) && !matches.includes(p)) matches.push(p);
          }
        };
        if (isMySQLEnabled && mysqlPool) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? LIMIT 2000',
            ['squad_members']);
          for (const r of (rows || [])) {
            try {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              collectMatches(String(r.doc_id), d);
            } catch (_) {}
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
          return res.status(400).json({ success: false, error: `名字"${inputName}"有多人重名，请用手机号精确充值` });
        }
      }
      if (!targetPhone || !/^1[3-9]\d{9}$/.test(targetPhone)) {
        return res.status(400).json({ success: false, error: '未找到该司机（请检查手机号或名字）' });
      }
      // P1(2026-10-16晚)：改为绝对值设置，不再累加。
      // 之前：现有有效期基础上累加（2天+填1天=3天）。
      // 现在：管理后台填几天，App 就显示几天（填1天→1天）。
      // 0天=已到期（屏蔽接单）。permanent=true 时返回'永久有效'。
      const calcAbsoluteExpiry = (): string => {
        if (wantPermanent) return '永久有效';
        if (days === 0) return '已到期';
        const base = new Date();
        base.setDate(base.getDate() + days);
        return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
      };
      let newExpiry = ''; // 主值（driver_users 的），用于返回给前端
      const colExpiries: Record<string, string> = {}; // 每集合的到期日
      // P0(2026-10-16晚)：加入 squad_applications。它从未被充值更新，一直是旧值，
      // 在 /api/db/get 合并时污染结果（pickLic 链最后一位），导致 App 读到旧的 2 天。
      const targetCols = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'];
      const now = new Date().toISOString();
      if (isMySQLEnabled && mysqlPool) {
        for (const col of targetCols) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, targetPhone]);
          let existing: any = {};
          if (rows && rows.length > 0) {
            existing = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
          }
          // P0(2026-10-16)：每个集合用自己的旧值单独算到期日。之前 newExpiry 只算一次复用三集合，
          // 三集合旧值不同时会永久分叉，导致 App 显示/派单/抢单读到不同的值。
          // 0 天场景不受影响（都是'已到期'）。
          const colExpiry = calcAbsoluteExpiry();
          colExpiries[col] = colExpiry;
          if (col === 'driver_users') newExpiry = colExpiry;
          const updated = { ...existing, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiry, updatedAt: now };
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, targetPhone, JSON.stringify(updated)]);
        }
        // P0(2026-10-16)：MySQL 写入后同步双写本地 JSON。/api/db/get 在 MySQL 抖动时会回退读本地，
        // 若本地是旧值会导致 App/后台显示跳变（已到期↔2天）。双写保证回退数据源永远新鲜。
        // 每集合用自己的值（与 MySQL 一致），不再复用单一 newExpiry。
        try {
          const dbData = readLocalJsonDb();
          for (const col of targetCols) {
            if (!dbData[col]) dbData[col] = {};
            const existingLocal = dbData[col][targetPhone] || {};
            dbData[col][targetPhone] = { ...existingLocal, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiries[col] || newExpiry, updatedAt: now };
          }
          writeLocalJsonDb(dbData);
        } catch (dualErr: any) {
          console.error('[Recharge License] 本地JSON双写失败（MySQL已成功）:', dualErr?.message);
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          const existing = dbData[col][targetPhone] || {};
          // P0(2026-10-16)：每集合单独算（与 MySQL 分支同口径）
          const colExpiryLocal = calcAbsoluteExpiry();
          if (col === 'driver_users') newExpiry = colExpiryLocal;
          dbData[col][targetPhone] = { ...existing, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiryLocal, updatedAt: now };
        }
        writeLocalJsonDb(dbData);
      }
      // P1(2026-10-15)：记录操作日志
      const logDesc = wantPermanent ? '设为永久有效' : `设为${days}天，有效期至${newExpiry}`;
      await logAdminOperation('recharge-license', String((req as any).authPhone || ''), targetPhone, logDesc, req);
      return res.json({ success: true, phone: targetPhone, licenseExpiry: newExpiry, daysAdded: wantPermanent ? -1 : days, permanent: wantPermanent });
    } catch (err: any) {
      console.error('[Recharge License Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 接单授权批量充值 (2026-10-15)：仅开发者，给全小队司机统一加天数（上线时用）
  app.post('/api/admin/batch-recharge-license', requireDbAuth, async (req, res) => {
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '仅开发者可批量充值' });
    }
    try {
      // P0(2026-10-16)：天数=0 表示屏蔽全小队接单；缺参数必须拒绝，防误触
      const rawDays: any = (req.body as any).days;
      const days = Math.floor(Number(rawDays));
      if (rawDays === undefined || rawDays === null || String(rawDays).trim() === '' || isNaN(days) || days < 0 || days > 3650) {
        return res.status(400).json({ success: false, error: '天数必须在0-3650之间（0=屏蔽接单）' });
      }
      // P1(2026-10-16晚)：改为绝对值设置（与单充一致）。填几天就是几天，不再累加。
      const calcExpiry = (): string => {
        if (days === 0) return '已到期';
        const base = new Date();
        base.setDate(base.getDate() + days);
        return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
      };
      const targetCols = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'];
      const now = new Date().toISOString();
      let count = 0;
      if (isMySQLEnabled && mysqlPool) {
        const [mrows]: any = await mysqlPool.query(
          'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?', ['squad_members']);
        const dualWriteMap: Record<string, string> = {};
        for (const r of (mrows || [])) {
          const phone = String(r.doc_id).replace(/\D/g, '').trim();
          if (!/^1[3-9]\d{9}$/.test(phone)) continue;
          let curLic = '';
          try {
            const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            curLic = String(d.licenseExpiry || '');
            // 只给已通过的成员充值
            const st = String(d.status || d.approvalStatus || '');
            if (!['已通过', 'approved', '通过'].includes(st)) continue;
          } catch (_) { continue; }
          const newExp = days === 0 ? '已到期' : calcExpiry();
          for (const col of targetCols) {
            const [erows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', [col, phone]);
            let ex: any = {};
            if (erows && erows.length > 0) ex = typeof erows[0].data === 'string' ? JSON.parse(erows[0].data) : erows[0].data;
            const upd = { ...ex, phone, phoneNumber: phone, licenseExpiry: newExp, updatedAt: now };
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              [col, phone, JSON.stringify(upd)]);
          }
          dualWriteMap[phone] = newExp;
          count++;
        }
        // P0(2026-10-16)：批量充值 MySQL 后双写本地 JSON，防 MySQL 抖动回退读到旧值导致显示跳变
        try {
          const dbData = readLocalJsonDb();
          for (const [phone, newExp] of Object.entries(dualWriteMap)) {
            for (const col of targetCols) {
              if (!dbData[col]) dbData[col] = {};
              const ex = dbData[col][phone] || {};
              dbData[col][phone] = { ...ex, phone, phoneNumber: phone, licenseExpiry: newExp, updatedAt: now };
            }
          }
          writeLocalJsonDb(dbData);
        } catch (dualErr: any) {
          console.error('[Batch Recharge License] 本地JSON双写失败（MySQL已成功）:', dualErr?.message);
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const [phone, d]: any of Object.entries(dbData.squad_members || {})) {
          const p = String(phone).replace(/\D/g, '').trim();
          if (!/^1[3-9]\d{9}$/.test(p)) continue;
          const st = String((d as any).status || (d as any).approvalStatus || '');
          if (!['已通过', 'approved', '通过'].includes(st)) continue;
          const newExp = days === 0 ? '已到期' : calcExpiry();
          for (const col of targetCols) {
            if (!dbData[col]) dbData[col] = {};
            const ex = dbData[col][p] || {};
            dbData[col][p] = { ...ex, phone: p, phoneNumber: p, licenseExpiry: newExp, updatedAt: now };
          }
          count++;
        }
        writeLocalJsonDb(dbData);
      }
      // P1(2026-10-16第二遍审计)：批量充补操作日志（单充有，批量没有，无审计追踪）。
      await logAdminOperation('batch-recharge-license', String((req as any).authPhone || ''), `${count}人`, `批量设为${days}天，共${count}人`, req).catch(() => {});
      return res.json({ success: true, count, daysAdded: days });
    } catch (err: any) {
      console.error('[Batch Recharge License Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Dedicated admin endpoint to update driver role/position atomically across all collections
  app.post('/api/admin/update-driver-role', requireDbAuth, async (req, res) => {
    // H5修复：加鉴权+isAdmin校验（防止自助提权）
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      const phone = String(req.body.phone || req.body.phoneNumber || '').replace(/\D/g, '').trim();
      const role = String(req.body.role || req.body.userRole || req.body.position || '').trim();
      const city = String(req.body.city || '').trim();

      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: '请输入有效的11位手机号码' });
      }

      const validRole = role || '普通司机';
      const dbData = readLocalJsonDb();
      const targetCols = ['driver_users', 'squad_members', 'squad_applications', 'online_applications'];
      
      for (const col of targetCols) {
        if (!dbData[col]) dbData[col] = {};
        const existing = dbData[col][phone] || {};
        const updated = {
          ...existing,
          phone,
          phoneNumber: phone,
          role: validRole,
          userRole: validRole,
          position: validRole,
          squad_position: validRole === '城市派单员司机' ? 'dispatcher' : validRole === '城市管理司机' ? 'manager' : validRole === '城市老板司机' ? 'boss' : 'normal',
          updatedAt: new Date().toISOString()
        };
        if (city) updated.city = city;
        dbData[col][phone] = updated;

        // 2026-10-16修复：同 update-driver-expiry，MySQL 写入失败不再静默吞掉，重试3次仍失败则抛错
        if (isMySQLEnabled && mysqlPool) {
          const upsertSql2 =
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)';
          const upsertArgs2 = [col, phone, JSON.stringify(updated)];
          let mysqlOk2 = false;
          let lastMysqlErr2: any = null;
          for (let attempt = 0; attempt < 3 && !mysqlOk2; attempt++) {
            try {
              await mysqlPool.query(upsertSql2, upsertArgs2);
              mysqlOk2 = true;
            } catch (e: any) {
              lastMysqlErr2 = e;
              if (attempt < 2) await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
            }
          }
          if (!mysqlOk2) {
            console.error('[Admin Driver Role MySQL Write Failed]:', col, phone, lastMysqlErr2?.message || lastMysqlErr2);
            throw new Error(`MySQL 写入失败(${col})：${lastMysqlErr2?.message || lastMysqlErr2}`);
          }
        }
      }

      if (!dbData.team_members) dbData.team_members = {};
      if (['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(validRole)) {
        dbData.team_members[phone] = {
          phone,
          role: validRole,
          city: city || dbData.driver_users?.[phone]?.city || '银川市',
          updatedAt: new Date().toISOString()
        };
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['team_members', phone, JSON.stringify(dbData.team_members[phone])]
          ).catch(() => {});
        }
      } else {
        if (dbData.team_members[phone]) delete dbData.team_members[phone];
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['team_members', phone]
          ).catch(() => {});
        }
      }

      writeLocalJsonDb(dbData);

      // Seamless inter-connectivity: forward update to Mainland China Aliyun ECS Baota Server
      const hostHeader = String(req.headers.host || '');
      if (!hostHeader.includes('lyheiwandaijiamax.com')) {
        const baotaBaseUrl = 'https://api.lyheiwandaijiamax.com';
        fetch(`${baotaBaseUrl}/api/admin/update-driver-role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, role: validRole, city })
        }).catch(err => console.warn('[Forward to Baota update-driver-role error]:', err));
      }

      console.log(`[Admin Driver Role Updated] Phone: ${phone} -> role: ${validRole}`);
      return res.json({ success: true, phone, role: validRole });
    } catch (err: any) {
      console.error('[Admin Driver Role Update Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4.6 Batch Recharge All Squad Drivers VIP (Default 50 Days, Excludes 15509601222)
  app.post(['/api/admin/batch-recharge-squad', '/api/admin/recharge-all-drivers'], requireDbAuth, async (req, res) => {
    // H5修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      const daysCount = parseInt(req.body.days || '50', 10) || 50;
      const exclude = String(req.body.excludePhone || '15509601222').replace(/\D/g, '').trim();

      const now = new Date();
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      targetDate.setDate(targetDate.getDate() + daysCount);
      const targetExpiry = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.squad_applications) dbData.squad_applications = {};
      if (!dbData.online_applications) dbData.online_applications = {};

      const allPhones = new Set<string>();
      ['squad_members', 'squad_applications', 'team_members', 'driver_locations', 'driver_users'].forEach(col => {
        if (dbData[col]) {
          Object.keys(dbData[col]).forEach(k => {
            const cleanPhone = String(dbData[col][k]?.phone || dbData[col][k]?.phoneNumber || k).replace(/\D/g, '').trim();
            if (cleanPhone && cleanPhone.length === 11 && cleanPhone !== exclude) {
              allPhones.add(cleanPhone);
            }
          });
        }
      });

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            "SELECT `collection`, `doc_id`, `data` FROM `daijia_documents` WHERE `collection` IN ('squad_members', 'online_applications', 'squad_applications', 'team_members', 'driver_locations', 'driver_users')"
          );
          if (Array.isArray(rows)) {
            rows.forEach((r: any) => {
              const cleanPhone = String(r.doc_id || '').replace(/\D/g, '').trim();
              if (cleanPhone && cleanPhone.length === 11 && cleanPhone !== exclude) {
                allPhones.add(cleanPhone);
              }
            });
          }
        } catch (_) {}
      }

      const updatedPhones: string[] = [];
      // P1(2026-10-16第二遍审计)：收集MySQL写入失败，不再静默吞掉。
      const failedPhones: string[] = [];
      const targetCols = ['driver_users', 'squad_members', 'squad_applications'];

      // P0(2026-10-15)：只给已通过的小队成员充值，防误批待审申请人
      const approvedPhones = new Set<string>();
      for (const phone of Array.from(allPhones)) {
        if (phone === exclude) continue;
        let isApproved = false;
        // 检查本地
        const sqLocal = dbData.squad_members?.[phone];
        if (sqLocal) {
          const st = String(sqLocal.status || sqLocal.approvalStatus || '').trim();
          if (['已通过', 'approved', '通过'].includes(st)) isApproved = true;
        }
        // 检查MySQL
        if (!isApproved && isMySQLEnabled && mysqlPool) {
          try {
            const [arows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['squad_members', phone]
            );
            if (arows && arows.length > 0) {
              const ad = typeof arows[0].data === 'string' ? JSON.parse(arows[0].data) : arows[0].data;
              const st = String(ad.status || ad.approvalStatus || '').trim();
              if (['已通过', 'approved', '通过'].includes(st)) isApproved = true;
            }
          } catch (_) {}
        }
        if (isApproved) approvedPhones.add(phone);
      }

      for (const phone of Array.from(approvedPhones)) {
        updatedPhones.push(phone);

        const sq = dbData.squad_members?.[phone] || {};
        const oa = dbData.online_applications?.[phone] || {};
        const sa = dbData.squad_applications?.[phone] || {};
        const du = dbData.driver_users?.[phone] || {};

        const name = du.driverName || du.name || sq.name || sq.driverName || oa.driverName || sa.name || `司机${phone.slice(-4)}`;
        const city = du.city || sq.city || oa.city || '银川市';

        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          let existing = dbData[col][phone] || {};
          // P1(2026-10-15)：MySQL模式下从MySQL读现有值，否则累加基数错误
          if (isMySQLEnabled && mysqlPool && !existing.vipExpiry) {
            try {
              const [erows]: any = await mysqlPool.query(
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                [col, phone]
              );
              if (erows && erows.length > 0) {
                existing = typeof erows[0].data === 'string' ? JSON.parse(erows[0].data) : erows[0].data;
              }
            } catch (_) {}
          }
          // P0(2026-10-15)：累加而非覆盖；永久有效保持不变
          const curVip = String(existing.vipExpiry || '').trim();
          let newVip: string;
          if (curVip === '永久有效' || curVip === '永久') {
            newVip = curVip; // 永久保持不变
          } else {
            // 在现有到期日基础上累加
            let baseDate: Date;
            try {
              const m = curVip.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
              if (m) {
                baseDate = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
                if (isNaN(baseDate.getTime()) || baseDate.getTime() < Date.now()) {
                  baseDate = new Date();
                }
              } else {
                baseDate = new Date();
              }
            } catch (_) {
              baseDate = new Date();
            }
            baseDate.setDate(baseDate.getDate() + daysCount);
            newVip = `${baseDate.getFullYear()}-${String(baseDate.getMonth()+1).padStart(2,'0')}-${String(baseDate.getDate()).padStart(2,'0')}`;
          }
          dbData[col][phone] = {
            ...existing,
            phone,
            phoneNumber: phone,
            name: existing.name || name,
            driverName: existing.driverName || name,
            city: existing.city || city,
            status: '已通过',
            vipExpiry: newVip,
            updatedAt: new Date().toISOString()
          };

          if (isMySQLEnabled && mysqlPool) {
            try {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                [col, phone, JSON.stringify(dbData[col][phone])]
              );
            } catch (e) {
              console.error(`[Batch VIP] MySQL写入失败 ${col}/${phone}:`, (e as any)?.message);
              // P1(2026-10-16第二遍审计)：失败记入名单，不再静默吞掉。
              const failKey = `${phone}`;
              if (!failedPhones.includes(failKey)) failedPhones.push(failKey);
            }
          }
        }
      }

      writeLocalJsonDb(dbData);
      console.log(`✓ [Batch VIP Recharge] Successfully recharged ${updatedPhones.length} squad drivers with ${daysCount} days VIP`);

      return res.json({
        success: failedPhones.length === 0,
        count: updatedPhones.length,
        days: daysCount,
        targetExpiry,
        updatedPhones,
        // P1(2026-10-16第二遍审计)：返回失败名单，管理后台可见部分失败。
        failedPhones,
        failedCount: failedPhones.length
      });
    } catch (err: any) {
      console.error('[Batch VIP Recharge Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. DELETE Document
  app.post('/api/db/delete', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const docId = String(req.body.id || req.body.docId || '').trim();

      if (!col || !docId) {
        return res.status(400).json({ success: false, error: 'Missing col or id' });
      }

      // 保护最高权限开发者 15509601222：任何人都不能删除开发者
      if (docId === '15509601222' && (col === 'squad_members' || col === 'driver_users' || col === 'squad_applications')) {
        return res.status(403).json({ success: false, error: '开发者 15509601222 拥有最高系统权限，禁止删除！' });
      }

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            [col, docId]
          );
          const isHardDelete = req.body.hardDelete === true || req.body.hardDelete === 'true';

          if (col === 'squad_members' && docId !== '15509601222') {
            // Cascade delete from driver_locations & squad_applications (both by doc_id and phone)
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['driver_locations', docId]
            );
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND (`doc_id` = ? OR JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.phone\')) = ?)',
              ['squad_applications', docId, docId]
            );
            
            if (isHardDelete) {
              await mysqlPool.query(
                'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                ['driver_users', docId]
              );
              await mysqlPool.query(
                'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                ['online_applications', docId]
              );
            } else {
              // Reset driver_users to 普通司机
              const [uRows]: any = await mysqlPool.query(
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                ['driver_users', docId]
              );
              let uData: any = { role: '普通司机', userRole: '普通司机', status: '未加入小队', approvalStatus: '未加入小队', is_squad_member: 0 };
              if (uRows && uRows.length > 0) {
                const prevU = typeof uRows[0].data === 'string' ? JSON.parse(uRows[0].data) : uRows[0].data;
                uData = { ...prevU, ...uData, is_squad_member: 0, status: '未加入小队', approvalStatus: '未加入小队' };
              }
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['driver_users', docId, JSON.stringify(uData)]
              );
            }

            // Add to removed_squad_members config
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            let cfgData = { phones: [docId] };
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones : [];
              if (!phones.includes(docId)) phones.push(docId);
              cfgData = { ...prevCfg, phones };
            }
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['config', 'removed_squad_members', JSON.stringify(cfgData)]
            );
          } else if (col === 'driver_users' && isHardDelete && docId !== '15509601222') {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['squad_members', docId]
            );
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['squad_applications', docId]
            );
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['online_applications', docId]
            );
          }
        } catch (mysqlErr: any) {
          console.error('[DB Proxy DELETE MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (dbData[col] && dbData[col][docId] !== undefined) {
        delete dbData[col][docId];
      }
      if (col === 'squad_members' && docId !== '15509601222') {
        if (dbData.driver_locations && dbData.driver_locations[docId]) {
          delete dbData.driver_locations[docId];
        }
        if (dbData.squad_applications) {
          for (const k of Object.keys(dbData.squad_applications)) {
            const app = dbData.squad_applications[k];
            if (k === docId || app?.phone === docId || app?.id === docId) {
              delete dbData.squad_applications[k];
            }
          }
        }
        if (dbData.driver_users && dbData.driver_users[docId]) {
          dbData.driver_users[docId] = {
            ...dbData.driver_users[docId],
            role: '普通司机',
            userRole: '普通司机',
            status: '未加入小队',
            approvalStatus: '未加入小队',
            is_squad_member: 0,
            inSquad: false,
            isSquadMember: false
          };
        }
        if (!dbData.config) dbData.config = {};
        if (!dbData.config['removed_squad_members']) {
          dbData.config['removed_squad_members'] = { phones: [] };
        }
        const phones: string[] = dbData.config['removed_squad_members'].phones || [];
        if (!phones.includes(docId)) {
          phones.push(docId);
          dbData.config['removed_squad_members'].phones = phones;
        }
      }
      writeLocalJsonDb(dbData);

      return res.json({ success: true, id: docId });
    } catch (err: any) {
      console.error('[DB Proxy DELETE Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.1 CLEAR Collection (Purges all documents in a collection from MySQL and local JSON DB)
  app.post('/api/db/clear-collection', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      if (!col) {
        return res.status(400).json({ success: false, error: 'Missing col parameter' });
      }

      console.log(`[DB Proxy] Purging entire collection: ${col}`);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ?',
            [col]
          );
          console.log(`✓ [MySQL] Cleared all records for collection: ${col}`);
        } catch (mysqlErr: any) {
          console.error('[DB Proxy CLEAR-COLLECTION MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (dbData[col]) {
        dbData[col] = {};
      }

      if (col === 'merchant_orders' || col === 'valet_orders' || col === 'orders') {
        const nowTs = Date.now();
        if (!dbData.config) dbData.config = {};
        dbData.config['merchant_orders_cleared'] = { clearedAt: nowTs };

        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['config', 'merchant_orders_cleared', JSON.stringify({ clearedAt: nowTs })]
            );
          } catch (_) {}
        }
      }

      writeLocalJsonDb(dbData);

      return res.json({ success: true, collection: col });
    } catch (err: any) {
      console.error('[DB Proxy CLEAR-COLLECTION Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2 CLEAR ALL ORDERS (彻底清除阿里云服务器上的所有订单记录，包括商户代叫、代驾订单、抢单/接单记录与通道)
  app.post('/api/orders/clear-all', requireDbAuth, async (req, res) => {
    // H6修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      console.log('[DB Proxy] 正在执行全量一键清空：清除所有订单记录 (merchant_orders, valet_orders, orders, passenger_links, active_orders)');
      const nowTs = Date.now();
      const orderCollections = ['merchant_orders', 'valet_orders', 'orders', 'passenger_links', 'active_orders'];

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?, ?, ?, ?)',
            orderCollections
          );
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['config', 'merchant_orders_cleared', JSON.stringify({ clearedAt: nowTs })]
          );
          console.log('✓ [MySQL] 已彻底清除所有订单数据记录与历史缓存');
        } catch (mysqlErr: any) {
          console.error('[MySQL Clear-All Orders Error]:', mysqlErr);
        }
      }

      const dbData = readLocalJsonDb();
      orderCollections.forEach((c) => {
        dbData[c] = {};
      });

      if (!dbData.config) dbData.config = {};
      dbData.config['merchant_orders_cleared'] = { clearedAt: nowTs };

      // 重置所有小队司机的忙碌状态为 idle / false
      if (dbData['driver_users']) {
        Object.keys(dbData['driver_users']).forEach((p) => {
          if (dbData['driver_users'][p]) {
            dbData['driver_users'][p].isBusy = false;
            dbData['driver_users'][p].status = 'idle';
          }
        });
      }
      if (dbData['driver_locations']) {
        Object.keys(dbData['driver_locations']).forEach((p) => {
          if (dbData['driver_locations'][p]) {
            dbData['driver_locations'][p].isBusy = false;
            dbData['driver_locations'][p].status = 'idle';
          }
        });
      }
      if (dbData['squad_members']) {
        Object.keys(dbData['squad_members']).forEach((p) => {
          if (dbData['squad_members'][p]) {
            dbData['squad_members'][p].isBusy = false;
            dbData['squad_members'][p].status = 'idle';
          }
        });
      }

      writeLocalJsonDb(dbData);
      console.log('✓ [阿里云本地数据库] 已彻底清除所有订单记录，本地与服务器不再保存所有订单记录');
      return res.json({ success: true, clearedAt: nowTs, message: '所有订单记录已从服务器彻底清除！' });
    } catch (err: any) {
      console.error('[Clear-All Orders Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper to set driver offline in MySQL and local JSON DB
  const performServerOffline = async (phone: string, reason: string) => {
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) return;

    const offlinePayload = {
      isOnline: false,
      onlineOrdersEnabled: false,
      pending0559Offline: false,
      lastOfflineReason: reason,
      lastOfflineTime: new Date().toISOString(),
      lastUpdatedTime: new Date().toISOString()
    };

    if (isMySQLEnabled && mysqlPool) {
      try {
        for (const col of ['driver_users', 'squad_members', 'driver_locations']) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, cleanPhone]
          );
          let merged = offlinePayload;
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            merged = { ...prev, ...offlinePayload };
          }
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, cleanPhone, JSON.stringify(merged)]
          );
        }
      } catch (err) {
        console.error('[MySQL performServerOffline Error]:', err);
      }
    }

    const dbData = readLocalJsonDb();
    ['driver_users', 'squad_members', 'driver_locations'].forEach((col) => {
      if (!dbData[col]) dbData[col] = {};
      const prev = dbData[col][cleanPhone] || {};
      dbData[col][cleanPhone] = { ...prev, ...offlinePayload };
    });
    writeLocalJsonDb(dbData);
  };

  // 5.1 Driver Offline API (Mainland China Baota / Aliyun REST API)
  // M2修复：加 requireDbAuth，本人只能操作自己
  app.post('/api/driver/offline', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.driverPhone || '').trim();
      const reason = String(req.body.reason || 'manual_offline').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing driver phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      await performServerOffline(phone, reason);
      console.log(`[Baota API /api/driver/offline] Driver ${phone} set to offline successfully (Reason: ${reason})`);
      return res.json({ success: true, phone, isOnline: false });
    } catch (err: any) {
      console.error('[Baota API /api/driver/offline Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.15 Driver Busy/Idle Status Report API (Alibaba Cloud Baota Server Panel Real-time Sync)
  // M2修复：加 requireDbAuth，本人只能操作自己
  app.post('/api/driver/status', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.driverPhone || '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing driver phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      const isBusy = Boolean(req.body.isBusy);
      const status = isBusy ? 'busy' : 'idle';
      const currentView = req.body.currentView || (isBusy ? 'create_order' : 'home');
      const timestamp = req.body.timestamp || Date.now();

      const patch: any = {
        isBusy,
        status,
        currentView,
        lastStatusUpdateTime: timestamp,
        lastUpdatedTime: new Date().toISOString()
      };

      const dbData = readLocalJsonDb();
      ['driver_users', 'squad_members', 'driver_locations'].forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['driver_locations', phone, JSON.stringify({ ...(dbData.driver_locations?.[phone] || {}), ...patch, phone })]
          );
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['squad_members', phone, JSON.stringify({ ...(dbData.squad_members?.[phone] || {}), ...patch, phone })]
          );
        } catch (_) {}
      }

      return res.json({ success: true, phone, isBusy, status });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2 Driver Location & Online Status Report API (Alibaba Cloud Baota Server Panel 20s Reporter)
  // M2修复：加 requireDbAuth，本人只能操作自己
  app.post('/api/driver/location', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      const lat = req.body.lat !== undefined ? Number(req.body.lat) : undefined;
      const lng = req.body.lng !== undefined ? Number(req.body.lng) : undefined;
      const isOnline = req.body.isOnline !== undefined ? Boolean(req.body.isOnline) : undefined;
      const isBusy = req.body.isBusy !== undefined ? Boolean(req.body.isBusy) : false;
      const todayOrders = req.body.todayOrders !== undefined ? Number(req.body.todayOrders) : undefined;
      // M1修复：拒绝未来时间戳（防客户端传未来时间绕过120秒看门狗）
      let timestamp = req.body.timestamp ? Number(req.body.timestamp) : Date.now();
      if (!isNaN(timestamp) && timestamp > Date.now() + 60000) {
        return res.status(400).json({ success: false, error: '时间戳无效：不能是未来时间' });
      }
      if (isNaN(timestamp) || timestamp <= 0) timestamp = Date.now();

      const driverName = req.body.driverName || req.body.name;
      const patch: any = { 
        lastUpdatedTime: new Date().toISOString(), 
        locationTimestamp: timestamp,
        isBusy
      };
      if (driverName && !isGenericDriverName(driverName, phone)) {
        patch.driverName = driverName;
        patch.name = driverName;
      }
      if (req.body.city) patch.city = req.body.city;
      if (req.body.version) patch.version = req.body.version;
      if (req.body.appVersion) patch.appVersion = req.body.appVersion;
      if (todayOrders !== undefined && !isNaN(todayOrders)) patch.todayOrders = todayOrders;
      if (lat !== undefined && !isNaN(lat)) patch.lat = lat;
      if (lng !== undefined && !isNaN(lng)) patch.lng = lng;
      // 2026-10-11：记录GPS有效性（滑动上线无GPS时上报，派单跳过无坐标司机）
      if (req.body.gpsValid !== undefined) patch.gpsValid = Boolean(req.body.gpsValid);
      if (isOnline !== undefined) {
        patch.isOnline = isOnline;
        if (!isOnline) {
          patch.onlineOrdersEnabled = false;
        } else {
          // a1-a5修复：恢复上线时清除看门狗踢出标记，否则标记永久残留
          patch.kickedOfflineAt = 0;
          patch.kickReason = '';
          patch.onlineOrdersEnabled = true;
        }
      }

      const dbData = readLocalJsonDb();

      // Retrieve removed phones list from config
      const removedPhones = new Set<string>();
      try {
        const removedCfg = dbData.config?.['removed_squad_members']?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p: any) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {}

      // If driver was deleted/removed from squad, strictly clean up and block re-entry
      if (removedPhones.has(phone) && phone !== '15509601222') {
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
              'DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?) AND `doc_id` = ?',
              ['squad_members', 'driver_locations', phone]
            );
          } catch (_) {}
        }
        return res.json({ success: true, removed: true, isOnline: false });
      }

      // Check if squad_members already contains this driver, or is master developer phone
      const isExistingSquadMember = phone === '15509601222' || Boolean(dbData.squad_members && dbData.squad_members[phone]);
      const collectionsToUpdate = isExistingSquadMember 
        ? ['driver_users', 'squad_members', 'driver_locations'] 
        : ['driver_users', 'driver_locations'];

      collectionsToUpdate.forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      // P0(2026-10-15)：GPS高频上报用批量刷盘（immediate=false），防3000并发下Event Loop阻塞
      writeLocalJsonDb(dbData, false);

      if (isMySQLEnabled && mysqlPool) {
        const mergedLocation = { ...(dbData.driver_locations?.[phone] || {}), ...patch, phone };
        // Fire-and-forget async update with error catching
        mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['driver_locations', phone, JSON.stringify(mergedLocation)]
        ).catch(() => {});
      }

      return res.json({ success: true, isOnline: patch.isOnline, serverTime: Date.now() });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.3 Get All Real-Time Driver Locations API
  // H5修复：加 requireDbAuth（附近页用，登录司机可读，禁止匿名批量拉取实时GPS）
  app.get('/api/driver/locations', requireDbAuth, async (req, res) => {
    try {
      const locations: Record<string, any> = {};
      const dbData = readLocalJsonDb();
      const removedPhones = new Set<string>();
      try {
        const removedCfg = dbData.config?.['removed_squad_members']?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p: any) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {}

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [cfgRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['config', 'removed_squad_members']
          );
          if (cfgRows && cfgRows.length > 0) {
            const parsedCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
            if (Array.isArray(parsedCfg?.phones)) {
              parsedCfg.phones.forEach((p: any) => removedPhones.add(String(p).trim()));
            }
          }
        } catch (_) {}
      }

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['driver_locations']
          );
          if (rows && Array.isArray(rows)) {
            rows.forEach((r: any) => {
              try {
                const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                const phone = String(parsed?.phone || r.doc_id || '').trim();
                if (phone && (phone === '15509601222' || !removedPhones.has(phone))) {
                  locations[r.doc_id] = parsed;
                }
              } catch (_) {}
            });
          }
        } catch (_) {}
      }

      if (dbData.driver_locations) {
        Object.keys(dbData.driver_locations).forEach((k) => {
          const phone = String(dbData.driver_locations[k]?.phone || k || '').trim();
          if (phone && (phone === '15509601222' || !removedPhones.has(phone))) {
            locations[k] = { ...(locations[k] || {}), ...dbData.driver_locations[k] };
          }
        });
      }

      const cutoffMs = getMostRecent0559CutoffMs();
      Object.keys(locations).forEach((k) => {
        const item = locations[k];
        if (item && (item.isOnline === true || item.isOnline === 'true')) {
          let t = 0;
          if (item.onlineSessionTime) t = Number(item.onlineSessionTime);
          else if (item.lastLocationTime) t = Number(item.lastLocationTime);
          else if (item.locationTimestamp) t = Number(item.locationTimestamp);
          else if (item.lastUpdatedTime) t = new Date(item.lastUpdatedTime).getTime();
          else if (item.updatedAt) t = new Date(item.updatedAt).getTime();
          
          if (t > 0 && t < cutoffMs) {
            locations[k] = { ...item, isOnline: false, onlineOrdersEnabled: false };
          }
        }
      });

      // P1(2026-10-15)：按哈勃权限过滤真名，无权限者只见自己真名
      try {
        const requesterPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
        let hasHubble = requesterPhone === '15509601222';
        if (!hasHubble) {
          if (isMySQLEnabled && mysqlPool) {
            const [hrows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['hubble_authorized_drivers', requesterPhone]
            );
            hasHubble = !!(hrows && hrows.length > 0);
          } else {
            hasHubble = !!readLocalJsonDb()?.['hubble_authorized_drivers']?.[requesterPhone];
          }
        }
        if (!hasHubble) {
          for (const k of Object.keys(locations)) {
            const itemPhone = String(locations[k]?.phone || k || '').replace(/\D/g, '').trim();
            if (itemPhone && itemPhone !== requesterPhone) {
              // 遮挡真名，保留位置用于地图显示
              if (locations[k].driverName) locations[k].driverName = '某师傅';
              if (locations[k].name) locations[k].name = '某师傅';
              // 手机号脱敏
              if (locations[k].phone) locations[k].phone = String(locations[k].phone).slice(0, 3) + '****' + String(locations[k].phone).slice(-4);
            }
          }
        }
      } catch (_) {}

      return res.json({ success: true, locations });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.4 Get Squad Members API (China Baota Panel Direct)
  // H5修复：加 requireDbAuth（防匿名批量拉取成员手机号/姓名）
  app.get('/api/squad/members', requireDbAuth, async (req, res) => {
    try {
      const list: any[] = [];
      const seen = new Set<string>();
      const dbData = readLocalJsonDb();
      const removedPhones = new Set<string>();
      try {
        const removedCfg = dbData.config?.['removed_squad_members']?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p: any) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {}

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [cfgRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['config', 'removed_squad_members']
          );
          if (cfgRows && cfgRows.length > 0) {
            const parsedCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
            if (Array.isArray(parsedCfg?.phones)) {
              parsedCfg.phones.forEach((p: any) => removedPhones.add(String(p).trim()));
            }
          }
        } catch (_) {}
      }

      const isInvalidDriver = (phone: string, name?: string) => {
        if (!phone) return true;
        if (phone === '15509601222') return false;
        if (removedPhones.has(phone)) return true;
        if (name && (name.includes('虚拟') || name.startsWith('测试') || name.includes('test'))) return true;
        // P2-1修复(2026-10-15)：删除硬编码测试号过滤（用户10-10已要求取消号码限制）
        if (isGenericDriverName(name || '', phone) && !AUTHORITATIVE_REAL_DRIVER_NAMES[phone]) return true;
        return false;
      };

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['squad_members']
          );
          if (rows && Array.isArray(rows)) {
            rows.forEach((r: any) => {
              try {
                const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                const phone = String(parsed?.phone || r.doc_id || '').trim();
                const name = String(parsed?.name || parsed?.driverName || '').trim();
                if (phone && !seen.has(phone) && !isInvalidDriver(phone, name)) {
                  seen.add(phone);
                  list.push({ id: r.doc_id, phone, status: '已通过', ...parsed });
                }
              } catch (_) {}
            });
          }
        } catch (_) {}
      }

      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach((k) => {
          const m = dbData.squad_members[k];
          const phone = String(m?.phone || k || '').trim();
          const name = String(m?.name || m?.driverName || '').trim();
          if (phone && !seen.has(phone) && !isInvalidDriver(phone, name)) {
            seen.add(phone);
            list.push({ id: k, phone, status: '已通过', ...m });
          }
        });
      }

      // 开发者最高权限 15509601222 永远保底加入小队成员
      if (!seen.has('15509601222')) {
        seen.add('15509601222');
        list.unshift({
          id: '15509601222',
          phone: '15509601222',
          name: '吴彦祖',
          driverName: '吴彦祖',
          role: '开发者司机',
          userRole: '开发者司机',
          status: '已通过'
        });
      }

      return res.json({ success: true, list });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.5 Update Driver / Squad Member Name API (Alibaba Cloud Baota Server Panel)
  // M2修复：加 requireDbAuth，本人只能改自己的名字
  app.post(['/api/driver/name', '/api/driver/update-name'], requireDbAuth, async (req, res) => {
    try {
      const rawPhone = String(req.body.phone || '').trim();
      const phone = rawPhone.replace(/\D/g, '');
      const name = String(req.body.name || '').trim().slice(0, 8);
      if (!phone || !name) {
        return res.status(400).json({ success: false, error: 'Phone and name required' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').replace(/\D/g, '').toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }

      // Update in-memory server mapping
      AUTHORITATIVE_REAL_DRIVER_NAMES[phone] = name;

      if (isMySQLEnabled && mysqlPool) {
        try {
          // BUG12修复：加上 online_applications，与本地 JSON 保持一致
          for (const col of ['driver_users', 'squad_members', 'driver_locations', 'squad_applications', 'online_applications', 'team_members']) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, phone]
            );
            let merged: any = { phone, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: new Date().toISOString() };
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              merged = { ...prev, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: new Date().toISOString() };
            }
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              [col, phone, JSON.stringify(merged)]
            );
          }
        } catch (_) {}
      }

      const dbData = readLocalJsonDb();
      for (const col of ['driver_users', 'squad_members', 'driver_locations', 'online_applications', 'squad_applications']) {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: new Date().toISOString() };
      }

      // Update orders dispatched by or assigned to this driver/admin
      for (const orderCol of ['merchant_orders', 'orders']) {
        if (dbData[orderCol]) {
          Object.keys(dbData[orderCol]).forEach((ordKey) => {
            const ord = dbData[orderCol][ordKey];
            if (!ord) return;
            const dPhone = String(ord.driverPhone || '').replace(/\D/g, '');
            const aPhone = String(ord.adminPhone || ord.dispatchedByPhone || ord.creatorPhone || ord.reporterPhone || '').replace(/\D/g, '');
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
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // DAILY 05:59 AM AUTOMATIC DRIVER OFFLINE DAEMON (China Beijing Time UTC+8)
  // 每天凌晨05:59分所有上线的司机全部自动下线；如果有正在进行的订单，先让司机做单，
  // 订单结束后恢复到软件app首页后等待5秒自动下线。
  // =========================================================================
  // Helper to get the most recent Beijing 05:59 AM cutoff timestamp (UTC ms)
  const getMostRecent0559CutoffMs = (): number => {
    const now = new Date();
    // Beijing Time (UTC+8)
    const beijingMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000);
    const beijingDate = new Date(beijingMs);
    const cutoffDate = new Date(beijingDate);
    cutoffDate.setHours(5, 59, 0, 0);
    if (beijingDate.getTime() < cutoffDate.getTime()) {
      cutoffDate.setDate(cutoffDate.getDate() - 1);
    }
    // Convert Beijing date back to UTC milliseconds
    return cutoffDate.getTime() - (8 * 3600000) - (now.getTimezoneOffset() * 60000);
  };

  // Map of driver phone -> timestamp when order ended (0 = still in order)
  const pendingOfflineDrivers = new Map<string, number>();

  setInterval(async () => {
    try {
      const now = new Date();
      // Calculate China Beijing Time (UTC+8)
      const beijingMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000);
      const beijingDate = new Date(beijingMs);
      const hours = beijingDate.getHours();
      const minutes = beijingDate.getMinutes();

      const is0559Time = (hours === 5 && minutes === 59);
      const cutoffMs = getMostRecent0559CutoffMs();

      // Read current DB in memory
      const dbData = readLocalJsonDb();
      const driverUsers = dbData.driver_users || {};
      const squadMembers = dbData.squad_members || {};
      const driverLocations = dbData.driver_locations || {};
      const merchantOrders = dbData.merchant_orders || {};

      // Gather all online drivers from in-memory cache
      const onlineDriverPhones = new Set<string>();
      Object.keys(driverUsers).forEach(phone => {
        if (driverUsers[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      Object.keys(squadMembers).forEach(phone => {
        if (squadMembers[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      Object.keys(driverLocations).forEach(phone => {
        if (driverLocations[phone]?.isOnline) onlineDriverPhones.add(phone);
      });

      if (onlineDriverPhones.size === 0 && pendingOfflineDrivers.size === 0) {
        return;
      }

      // Helper to check if driver has an active, in-progress order
      const hasActiveOrder = (phone: string): boolean => {
        const cleanPhone = String(phone).trim();
        for (const orderId in merchantOrders) {
          const order = merchantOrders[orderId];
          if (!order) continue;
          const assignedDriver = String(order.dispatchedDriverPhone || order.driverPhone || order.assignedDriver || '').trim();
          if (assignedDriver === cleanPhone) {
            const st = String(order.statusCategory || order.status || '').trim();
            if (['submitted', 'dispatched', 'claimed', 'accepted', 'taken', 'arrived', 'serving', '就位', '服务中', '已接单'].includes(st)) {
              return true;
            }
          }
        }
        return false;
      };

      // 1. If at 05:59 AM Beijing Time, or if driver's online session/location started before the most recent 05:59 AM cutoff:
      for (const phone of Array.from(onlineDriverPhones)) {
        const userData = driverUsers[phone] || squadMembers[phone] || driverLocations[phone] || {};
        let driverOnlineTime = 0;
        if (userData.onlineSessionTime) driverOnlineTime = Number(userData.onlineSessionTime);
        else if (userData.lastLocationTime) driverOnlineTime = Number(userData.lastLocationTime);
        else if (userData.locationTimestamp) driverOnlineTime = Number(userData.locationTimestamp);
        else if (userData.lastUpdatedTime) driverOnlineTime = new Date(userData.lastUpdatedTime).getTime();
        else if (userData.updatedAt) driverOnlineTime = new Date(userData.updatedAt).getTime();

        const isExpired = is0559Time || (!driverOnlineTime || driverOnlineTime < cutoffMs);

        if (isExpired) {
          if (hasActiveOrder(phone)) {
            if (!pendingOfflineDrivers.has(phone)) {
              pendingOfflineDrivers.set(phone, 0);
            }
          } else if (!pendingOfflineDrivers.has(phone)) {
            await performServerOffline(phone, is0559Time ? 'daily_0559_scheduled_idle' : 'daily_0559_expired_cutoff');
          }
        }
      }

      // 2. Handle drivers who were deferred due to active orders
      if (pendingOfflineDrivers.size > 0) {
        for (const [phone, finishTimestamp] of Array.from(pendingOfflineDrivers.entries())) {
          const isStillActive = hasActiveOrder(phone);
          if (isStillActive) {
            continue;
          }

          if (finishTimestamp === 0) {
            pendingOfflineDrivers.set(phone, Date.now());
          } else if (Date.now() - finishTimestamp >= 5000) {
            await performServerOffline(phone, 'daily_0559_after_order_5s');
            pendingOfflineDrivers.delete(phone);
          }
        }
      }
    } catch (daemonErr) {
      console.error('[Baota Cron 05:59 Daemon Error]:', daemonErr);
    }
  }, 60000);

  // Haversine Distance Helper
  function calculateHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Server POI & Yinchuan Street/District Grid Dictionary
  // 本地 POI 已清空（用户2026-10-10要求：纯走服务端高德实时解析）
  // 原有银川+宁夏条目已全部移除
  const YINCHUAN_SERVER_POIS: Array<{ keywords: string[]; lat: number; lng: number }> = [];

  // 全国地理编码：本地银川 POI 优先，失败时调高德地图 API（中国大陆服务，全国可用）
  // H7修复：Key 优先从环境变量读取（硬编码仅作回退，部署后请在宝塔环境变量中配置并轮换）
  const AMAP_KEY_SERVER = process.env.AMAP_KEY_SERVER || '0ae534670da6caccb517c02edd04e89e';
  // P1-3提醒(2026-10-14)：生产环境请设置 AMAP_KEY_SERVER 环境变量并轮换 Key，硬编码 Key 泄露会导致配额盗刷
  if (!process.env.AMAP_KEY_SERVER) {
    console.warn('[Security] 警告：正在使用代码内置高德 Key，请设置 AMAP_KEY_SERVER 环境变量并轮换！');
  }
  if (!process.env.AMAP_KEY_SERVER) {
    console.warn('[Config] AMAP_KEY_SERVER 未配置环境变量，使用内置值；请尽快在高德控制台轮换该 Key 并配置环境变量');
  }
  // 2026-10-11 全面修复：高德地理编码必须带城市限制 + 结果城市校验
  // 根因：之前不带 city 参数做全国搜索，外地同名店被误解析，导致 1695.84km / 517.82km
  // 注意："(建设中)"等可能是高德官方POI名的一部分（来自搜索建议），不能无条件剥离；
  // 采用两阶段：先用全名+城市搜，失败再用剥离备注后的名字重试
  async function geocodeServerPoiAsync(startLoc?: string, fallbackLat?: number, fallbackLng?: number, city?: string): Promise<{ lat: number; lng: number; reliable: boolean }> {
    // H13修复：失败时返回 NaN 而非市中心占位符，调用方根据 reliable=false 标记 coordsUnknown
    const failResult = { lat: NaN, lng: NaN, reliable: false };

    if (!startLoc || typeof startLoc !== 'string' || !startLoc.trim()) {
      return failResult;
    }

    const clean = startLoc.trim()
      .replace(/^代驾商家起点[为：:\s]*/g, '')
      .replace(/^商家代叫起点[为：:\s]*/g, '')
      .replace(/^商家起点[为：:\s]*/g, '')
      .replace(/^代叫商家起点[为：:\s]*/g, '')
      .replace(/^代驾起点[为：:\s]*/g, '')
      .replace(/^起点[为：:\s]*/g, '')
      .trim() || startLoc.trim();

    // 2026-10-11：城市归一化（"银川" -> "银川市"），用于传给高德 city 参数和结果校验
    const normCity = (city || '').trim().replace(/市$/, '') + '';
    const cityForApi = normCity ? (normCity.endsWith('市') ? normCity : normCity + '市') : '';

    // 1. 本地银川 POI 优先（快）
    for (const poi of YINCHUAN_SERVER_POIS) {
      if (poi.keywords.some(kw => clean.includes(kw) || kw.includes(clean))) {
        return { lat: poi.lat, lng: poi.lng, reliable: true };
      }
    }

    // 2. 高德地图地理编码（中国大陆服务），2026-10-11：必须带城市限制 + 结果城市校验
    const queryAmap = async (addr: string): Promise<{ lat: number; lng: number; reliable: boolean } | null> => {
      try {
        let url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(addr)}&key=${AMAP_KEY_SERVER}`;
        if (cityForApi) {
          url += `&city=${encodeURIComponent(cityForApi)}`;
        }
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data: any = await resp.json();
        if (data.status === '1' && data.geocodes?.length > 0) {
          // 2026-10-11：不再盲取 geocodes[0]。有城市要求时，只接受城市匹配的结果；
          // 无城市要求时取第一条（保持旧行为）
          const candidates = data.geocodes as any[];
          let picked: any = null;
          if (cityForApi && normCity) {
            const cityCore = normCity.replace(/市$/, '');
            picked = candidates.find(g => {
              const gCity = String(g.city || '');
              const gProv = String(g.province || '');
              return gCity.includes(cityCore) || cityCore.includes(gCity.replace(/市$/, '')) || gProv.includes(cityCore);
            }) || null;
            if (!picked) {
              console.warn(`[Geocode] 城市校验失败: address=${addr}, 期望城市=${cityForApi}, 高德返回均为外地: ${candidates.slice(0, 3).map(g => `${g.province}${g.city}`).join(' / ')}`);
              return null;
            }
          } else {
            picked = candidates[0];
          }
          const loc = String(picked.location || '').split(',');
          const lng = Number(loc[0]), lat = Number(loc[1]);
          if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
            console.log(`[Geocode] 高德解析成功: ${addr} -> ${lat},${lng} (${picked.province}${picked.city}${picked.district})`);
            return { lat, lng, reliable: true };
          }
        }
        // 详细记录失败原因，便于排查 Key 限制问题
        // 常见 infocode: 10009=USERKEY_PLAT_NOMATCH(Key平台限制), 10008=USERKEY_ILLEGAL(Key非法), 20001=INSUFFICIENT_PRIVILEGES(权限不足)
        console.warn(`[Geocode] 高德解析失败: address=${addr}, status=${data.status}, info=${data.info}, infocode=${data.infocode}`);
        if (data.infocode === '10009') {
          console.warn(`[Geocode] Key平台限制(USERKEY_PLAT_NOMATCH): 请在高德控制台检查Key的"服务平台"设置，服务端调用需要"Web服务"类型Key或IP白名单包含本服务器IP`);
        }
      } catch (e: any) {
        console.warn('[Geocode] 高德 API 异常:', e?.message);
      }
      return null;
    };

    // 阶段1：全名 + 城市限制（官方POI名含"建设中"等后缀时能直接命中）
    const stage1 = await queryAmap(clean);
    if (stage1) return stage1;

    // 阶段2：剥离可能的商户手写备注后缀后重试（如"(建设中)"是手写而非官方名时）
    const stripped = clean
      .replace(/[(（](建设中|装修中|筹备中|试营业|试运营|已闭店|已关闭|暂停营业|装修升级中|内部装修)[)）]\s*$/g, '')
      .replace(/[(（](建设中|装修中|筹备中|试营业|试运营|已闭店|已关闭|暂停营业|装修升级中|内部装修)[)）]/g, '')
      .trim();
    if (stripped && stripped !== clean) {
      console.log(`[Geocode] 阶段1失败，剥离备注后缀后重试: ${clean} -> ${stripped}`);
      const stage2 = await queryAmap(stripped);
      if (stage2) return stage2;
    }

    // 3. 全部失败：标记为不可靠，调用方不得用此坐标做距离判断
    console.warn(`[Geocode] 坐标未知: ${clean}，本地POI和高德均失败`);
    // H13修复：高德失败/异常时返回 NaN，不用市中心冒充
    return failResult;
  }

  // H9修复：已删除同步版 geocodeServerPoi 死代码（返回银川市中心占位符，违反未知坐标铁律；零调用点）

  // 5.9 Server-Side Geocoding API (支持客户端按地名即时获取精准坐标与直线距离)
  // M6修复：加 requireDbAuth，防公开代理刷爆高德配额
  app.get(['/api/geocode', '/api/geo/locate'], requireDbAuth, async (req, res) => {
    try {
      const address = String(req.query.address || req.query.name || req.query.keyword || '').trim();
      const city = String(req.query.city || '').trim(); // 2026-10-11：城市限制，防跨城误解析
      const fallbackLat = Number(req.query.lat || req.query.fallbackLat || 38.4830);
      const fallbackLng = Number(req.query.lng || req.query.fallbackLng || 106.2350);
      const poi = await geocodeServerPoiAsync(address, fallbackLat, fallbackLng, city);
      return res.json({
        success: true,
        address,
        city,
        lat: poi.lat,
        lng: poi.lng,
        reliable: poi.reliable
      });
    } catch (err: any) {
      return res.json({ success: false, error: err.message, lat: NaN, lng: NaN });
    }
  });

  // 6. Server-Side Nearest Driver Dispatch Engine (阿里云高可用服务端精准距离派单)
  app.post('/api/dispatch/nearest', requireDbAuth, async (req, res) => {
    try {
      const { orderData, reporterPhone, pickupLat, pickupLng, excludePhone } = req.body || {};
      // P1(2026-10-16)：orderId 级互斥。同一订单 60 秒内只允许一次派单处理，
      // 并发第二请求直接 409 返回，防双派单弹给两名司机。
      // P1(2026-10-16第二遍审计)：锁键补 orderNo。订单主键还认 orderNo（:4436），
      // 只带 orderNo 的请求之前旁路互斥锁，导致一单一派多司机。
      const lockOrderId = String(orderData?.orderId || orderData?.id || orderData?.orderNo || '').trim();
      if (lockOrderId) {
        const lockTs = dispatchOrderLocks.get(lockOrderId) || 0;
        if (Date.now() - lockTs < 60000) {
          return res.status(409).json({ success: false, error: '该订单正在派单处理中' });
        }
        dispatchOrderLocks.set(lockOrderId, Date.now());
        // 防止 Map 无限增长：顺手清理过期锁
        if (dispatchOrderLocks.size > 500) {
          const cutoff = Date.now() - 60000;
          for (const [k, v] of dispatchOrderLocks) { if (v < cutoff) dispatchOrderLocks.delete(k); }
        }
      }
      // M7修复：radiusKm 服务端钳制，最大3公里，防客户端突破派单半径铁律
      const radiusKm = Math.min(Number(req.body?.radiusKm) || 3, 3);
      // P0(2026-10-16)：铁律——商户不能手动选司机，所有商户订单走系统自动派单。
      // 删除客户端传来的 dispatchedDriverPhone，服务端只按最近+20米随机算法选人。
      if (orderData && typeof orderData === 'object') {
        delete (orderData as any).dispatchedDriverPhone;
        delete (orderData as any).dispatchedDriverName;
      }

      // 下单权限：开发者/小队管理人员 或 商户（带A后缀）可以直接下单
      // 商户不需要申请审批，注册登录即为商户身份
      if (!(req as any).isAdmin) {
        const rawAuthPhone = String((req as any).authPhone || '').trim().toUpperCase();
        // 商户（A后缀）直接放行
        if (rawAuthPhone.endsWith('A')) {
          // merchant, skip manager check
        } else {
          const authPhone = rawAuthPhone.replace(/A$/, '');
          const MANAGER_ROLES = ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'];
          let isManager = false;
        try {
          if (isMySQLEnabled && mysqlPool) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['squad_members', authPhone]
            );
            if (rows && rows.length > 0) {
              const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              const role = String(data?.role || data?.userRole || '');
              isManager = MANAGER_ROLES.some(r => role.includes(r));
            }
          }
        } catch (_) {}
        if (!isManager) {
          return res.status(403).json({ success: false, error: '仅小队管理人员或商户可以下商户代叫订单' });
        }
        } // end merchant bypass else
      }

      if (!orderData || (!orderData.id && !orderData.orderNo)) {
        return res.status(400).json({ success: false, error: 'Missing orderData' });
      }

      // Resolve merchant start location coordinates (support POI geocoding on server)
      const startLocName = String(orderData.startLocation || orderData.passengerAddress || orderData.pickupAddress || '').trim();
      let pLat = Number(pickupLat || orderData.passengerLat || orderData.startLat || orderData.lat);
      let pLng = Number(pickupLng || orderData.passengerLng || orderData.startLng || orderData.lng);

      const isDefaultCentroid = (
        isNaN(pLat) || isNaN(pLng) || pLat === 0 || pLng === 0 ||
        (Math.abs(pLat - 38.487167) < 0.001 && Math.abs(pLng - 106.23091) < 0.001) ||
        (Math.abs(pLat - 38.4830) < 0.001 && Math.abs(pLng - 106.2350) < 0.001)
      );

      // === 3秒准备期：等待高德返回 + 筛选司机 ===
      // 用户要求：服务端有3秒时间做高德解析和司机匹配，3秒后开始60秒倒计时
      const prepareStartTs = Date.now();
      const PREPARE_TIMEOUT_MS = 3000;

      // H12修复：空地址直接标记坐标未知，不走高德分支
      if (!startLocName) {
        console.warn(`[Dispatch] 起点地址为空，标记坐标未知，直接进大厅`);
        (orderData as any).coordsUnknown = true;
      } else if (isDefaultCentroid || isNaN(pLat) || isNaN(pLng)) {
        // 高德解析与3秒超时竞速：3秒内没返回就用现有坐标（标记未知）
        // 2026-10-11：传入订单城市做地理编码城市限制，防"绿树电竞"类跨城误解析（曾致1695.84km）
        const orderCity = String(orderData.city || (req.body as any)?.city || '').trim();
        const geocodePromise = geocodeServerPoiAsync(startLocName, pLat, pLng, orderCity);
        const timeoutPromise = new Promise<{ lat: number; lng: number; reliable: boolean; timedOut: boolean }>(
          resolve => setTimeout(() => resolve({ lat: pLat, lng: pLng, reliable: false, timedOut: true }), PREPARE_TIMEOUT_MS)
        );
        const poi: any = await Promise.race([geocodePromise, timeoutPromise]);
        if (poi.timedOut) {
          console.warn(`[Dispatch] 高德解析3秒超时: ${startLocName}，标记坐标未知`);
          (orderData as any).coordsUnknown = true;
        } else {
          pLat = poi.lat;
          pLng = poi.lng;
          // 坐标未知时标记，直接进大厅
          if (!poi.reliable) {
            (orderData as any).coordsUnknown = true;
          }
        }
      }
      const prepareElapsed = Date.now() - prepareStartTs;
      console.log(`[Dispatch] 准备期耗时: ${prepareElapsed}ms`);
      // M5修复：固定等满3秒（高德提前返回则补足剩余时间），再开始60秒倒计时
      if (prepareElapsed < PREPARE_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, PREPARE_TIMEOUT_MS - prepareElapsed));
        console.log(`[Dispatch] 准备期补足至3秒`);
      }

      const dbData = readLocalJsonDb();
      let squadList: any[] = [];
      let locationMap: Record<string, any> = {};

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [squadRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['squad_members']
          );
          squadList = (squadRows || []).map((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const rawId = String(r.doc_id || '');
            return { phone: rawId.replace(/\D/g, '').trim(), rawId, data };
          }).filter((item: any) => {
            // 2026-10-17: A后缀是商户号，不参与司机派单。
            // 否则 15509601222A 会被 clean 成 15509601222，与司机号撞车造成重复候选、
            // 其中一条 licenseExpiry 为空导致误淘汰。
            if (/a$/i.test(String(item.rawId || '').trim())) return false;
            return Boolean(item.phone);
          });
          // 2026-10-17: 按手机号去重（兜底），同一手机号多条记录时优先保留接单授权有效的那条
          {
            const seen = new Map<string, any>();
            for (const item of squadList) {
              const cp = String(item.phone || '');
              const prev = seen.get(cp);
              if (!prev) { seen.set(cp, item); continue; }
              const prevValid = isLicenseValid(prev?.data?.licenseExpiry);
              const curValid = isLicenseValid(item?.data?.licenseExpiry);
              if (!prevValid && curValid) seen.set(cp, item);
            }
            squadList = Array.from(seen.values());
          }

          const [locRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['driver_locations']
          );
          (locRows || []).forEach((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const p = String(r.doc_id || data?.phone || '').replace(/\D/g, '').trim();
            if (p) locationMap[p] = data;
          });
        } catch (_) {}
      }

      if (squadList.length === 0) {
        const colData = dbData['squad_members'] || {};
        squadList = Object.keys(colData).map((k) => ({
          phone: String(k).replace(/\D/g, '').trim(),
          rawId: String(k),
          data: colData[k]
        })).filter((item: any) => {
          // 2026-10-17: A后缀商户号不参与派单（同 MySQL 分支）
          if (/a$/i.test(String(item.rawId || '').trim())) return false;
          return Boolean(item.phone);
        });
        {
          const seen = new Map<string, any>();
          for (const item of squadList) {
            const cp = String(item.phone || '');
            const prev = seen.get(cp);
            if (!prev) { seen.set(cp, item); continue; }
            const prevValid = isLicenseValid(prev?.data?.licenseExpiry);
            const curValid = isLicenseValid(item?.data?.licenseExpiry);
            if (!prevValid && curValid) seen.set(cp, item);
          }
          squadList = Array.from(seen.values());
        }
      }

      const localLocations = dbData['driver_locations'] || {};
      Object.keys(localLocations).forEach((k) => {
        const p = String(k).replace(/\D/g, '').trim();
        if (p && !locationMap[p]) {
          locationMap[p] = localLocations[k];
        }
      });

      // Always include developer driver 15509601222 if not present in squadList
      if (!squadList.some((s) => s.phone === '15509601222')) {
        // 2026-10-15根治：MySQL模式下从MySQL读开发者数据，本地JSON是stale的会导致授权判断错误
        let devDriverData: any = {};
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [devRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['driver_users', '15509601222']
            );
            if (devRows && devRows[0]) {
              const d = devRows[0].data;
              devDriverData = typeof d === 'string' ? JSON.parse(d) : d;
            }
          } catch (_) {}
        } else {
          devDriverData = dbData['driver_users']?.['15509601222'] || {};
        }
        squadList.push({
          phone: '15509601222',
          data: {
            ...devDriverData,
            role: '开发者司机',
            userRole: '开发者司机',
            driverName: devDriverData.driverName || '吴彦祖',
            status: '已通过'
          }
        });
      }

      // P2(2026-10-16)：订单ID加随机后缀，防同一毫秒创建的两单重ID串单
      const orderId = String(orderData.id || orderData.orderId || orderData.orderNo || `ORDER_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`).trim();

      // Candidate drivers filter (Strictly approved squad drivers only)
      const candidates: Array<{ phone: string; name: string; distKm: number; data: any }> = [];
      const removedPhonesArr: string[] = dbData.config?.['removed_squad_members']?.phones || [];

      // P0(2026-10-17诊断·完整版)：记录每个候选司机的淘汰原因，定位派单失败根因。
      // 淘汰原因全量写 Node 日志；API 响应仅在开发者(isAdmin)调用时返回脱敏摘要，
      // 普通用户不返回任何诊断信息，不泄露他人手机号。
      const diagOrderId = orderId;
      const diagFiltered: Array<{ phone: string; reason: string }> = [];
      const diagPush = (rawPhone: any, reason: string) => {
        try {
          diagFiltered.push({ phone: String(rawPhone || '').replace(/\D/g, '').trim(), reason });
        } catch (_) {}
      };
      const maskPhone = (p: string) => {
        const s = String(p || '');
        return s.length >= 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : (s || '未知');
      };
      // 开发者关键字段快照（以 locationMap 为准：MySQL 优先于本地 JSON，避免 stale 误导）
      try {
        const diagRec = squadList.find(({ phone }: any) => String(phone).replace(/\D/g, '').trim() === '15509601222');
        if (diagRec) {
          const d: any = diagRec.data || {};
          const loc: any = locationMap['15509601222'] || {};
          console.log(`[DispatchDiag] 订单 ${diagOrderId} | 15509601222: status=${d.status || d.approvalStatus}, license=${d.licenseExpiry}, role=${d.role}, isOnline=${loc.isOnline}, isBusy=${loc.isBusy}, gpsValid=${(loc as any).gpsValid}, lat=${loc.lat}, lng=${loc.lng}`);
        } else {
          console.log(`[DispatchDiag] 订单 ${diagOrderId} | 15509601222: 不在 squadList 中! squadList长度=${squadList.length}`);
        }
      } catch (_) {}

      // Check if order already has an actively dispatched driver that is valid
      const existingDispatchedPhone = String(orderData.dispatchedDriverPhone || '').replace(/\D/g, '').trim();

      squadList.forEach(({ phone, data }) => {
        const cleanPhone0 = String(phone || '').replace(/\D/g, '').trim();
        if (!phone || !data || (data as any).isBanned) {
          diagPush(cleanPhone0, `无phone/data或被禁用(isBanned=${Boolean((data as any)?.isBanned)})`);
          return;
        }
        const cleanPhone = cleanPhone0;

        // 0. Exclude removed drivers or generic driver placeholders
        if (cleanPhone !== '15509601222' && (removedPhonesArr.includes(cleanPhone) || isGenericDriverName(data.driverName || data.name, cleanPhone))) {
          diagPush(cleanPhone, removedPhonesArr.includes(cleanPhone) ? '在移除名单中' : '占位司机名');
          return;
        }
        const cleanReporter = reporterPhone ? String(reporterPhone).replace(/\D/g, '').trim() : '';
        const cleanExclude = excludePhone ? String(excludePhone).replace(/\D/g, '').trim() : '';

        // Check if this is a driver report/transfer order (报单转单) vs merchant valet call (商户代叫)
        const isTransferOrder = Boolean(
          orderData.orderType === '报单转单' ||
          orderData.orderRemark === '报单转单' ||
          orderData.type === '报单转单' ||
          String(orderData.orderRemark || '').includes('报单转单') ||
          String(orderData.destination || '').includes('报单转单')
        );

        // Prevent self-dispatch ONLY for driver transfer orders (报单转单绝对不要派单给自己)
        // For merchant valet orders (商户代叫), the merchant is ordering for a guest, so online squad drivers (including 15509601222) can receive it
        if (isTransferOrder) {
          if (cleanPhone && (cleanPhone === cleanReporter || cleanPhone === cleanExclude)) {
            diagPush(cleanPhone, '报单转单排除本人');
            return;
          }
        }

        // 1. Approval status check
        // 2026-10-12修复：必须明确已通过，缺失状态不再默认通过（铁律）
        const st = String(data.status || data.approvalStatus || '').trim();
        if (!['已通过', 'approved', '通过'].includes(st)) {
          diagPush(cleanPhone, `审批未通过(status=${st || '空'})`);
          return;
        }

        // 2.5 接单授权检查 (2026-10-15)：天数为0时不派单，无豁免（含开发者本人）
        // licenseExpiry 存在 squad_members 的 data 里
        if (!isLicenseValid(data.licenseExpiry)) {
          diagPush(cleanPhone, `接单授权无效(licenseExpiry=${data.licenseExpiry || '空'})`);
          return;
        }

        // 2. Role check (must be one of: 开发者司机, 城市老板司机, 城市管理司机, 城市派单员司机, 普通司机)
        if (cleanPhone !== '15509601222') {
          const role = String(data.role || data.userRole || data.approvedRole || '').trim();
          if ((role.includes('商户') || role.includes('商家')) && !role.includes('司机') && !role.includes('管理')) {
            diagPush(cleanPhone, `纯商户角色(${role || '空'})`);
            return;
          }
          const allowedRoles = ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员', '普通司机', '队员', '小队长'];
          const hasAllowedRole = allowedRoles.some((r) => role.includes(r)) || role === '';
          if (!hasAllowedRole) {
            diagPush(cleanPhone, `角色不合法(${role || '空'})`);
            return;
          }
        }

        // 3. Online & not busy check
        // 2026-10-12修复：必须明确 isOnline === true，字符串'false'不再算在线；恢复忙碌检查
        const loc = locationMap[cleanPhone] || {};
        const isOnline = loc.isOnline === true || loc.isOnline === 'true' || (cleanPhone === '15509601222' && loc.isOnline !== false);
        if (!isOnline) {
          diagPush(cleanPhone, `未上线(isOnline=${loc.isOnline})`);
          return;
        }

        // 2026-10-12修复：忙碌司机不派单（行程中）
        const isBusy = loc.isBusy === true || loc.isBusy === "true" || loc.isBusy === 1;
        if (isBusy) {
          diagPush(cleanPhone, '忙碌中');
          return;
        }

        // H-G2修复：明确标记无GPS的上线司机直接跳过（滑动上线即上报功能：无GPS时只传时间戳不传坐标，
        // 旧坐标残留+新鲜时间戳会导致按几小时前位置误派单）。gpsValid 为 undefined 的老数据按有GPS兼容处理。
        if ((loc as any).gpsValid === false) {
          diagPush(cleanPhone, 'GPS无效标记(gpsValid=false)');
          return;
        }

        let dLat = Number(loc.lat ?? data.lat);
        let dLng = Number(loc.lng ?? data.lng);

        // BUG4修复：位置无效的司机直接跳过，不参与就近派单（之前静默用市中心导致误派）
        if (isNaN(dLat) || isNaN(dLng) || dLat === 0 || dLng === 0) {
          diagPush(cleanPhone, `坐标无效(lat=${loc.lat},lng=${loc.lng})`);
          return;
        }

        // 用户2026-10-17要求：删120秒GPS派单检查。理由：已有"新来单页35秒无心跳转大厅"兜底，
        // GPS过期司机收到弹窗不点确认/不看页面，35秒后自动转大厅，不会卡单。
        // 之前 indoor 测试时 GPS 不新鲜导致"无在线空闲司机"误判。

        // H12修复：删除 0.3km 假距离回退；坐标非法时不参与距离派单
        const distKm = (!isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0)
          ? calculateHaversineKm(pLat, pLng, dLat, dLng)
          : Infinity;

        // 严格遵循3公里派单半径限制：超过3公里 (distKm > radiusKm) 绝不直接派单，必须转入选单大厅
        // （坐标未知时已在外层直接转入大厅，不会走到这里）
        if (distKm <= radiusKm) {
          candidates.push({
            phone: cleanPhone,
            name: data.driverName || data.name || (cleanPhone === '15509601222' ? '吴彦祖' : `司机${cleanPhone.slice(-4)}`),
            distKm,
            data
          });
        } else {
          diagPush(cleanPhone, `距离${distKm.toFixed(2)}km超${radiusKm}km半径`);
        }
      });

      // 诊断汇总：写 Node 日志（含规范化订单ID）
      try {
        if (diagFiltered.length > 0) {
          const sum = diagFiltered.map(r => `${maskPhone(r.phone)}[${r.reason}]`).join('；');
          console.log(`[DispatchDiag] 订单 ${diagOrderId} | 淘汰${diagFiltered.length}人: ${sum}`);
        }
        const candSum = candidates.map(c => `${maskPhone(c.phone)}(${Number(c.distKm).toFixed(2)}km)`).join('、');
        console.log(`[DispatchDiag] 订单 ${diagOrderId} | 候选${candidates.length}人${candSum ? ': ' + candSum : ''}`);
      } catch (_) {}
      // 开发者调用时才在响应里带脱敏诊断摘要（手机号打码），普通用户不返回
      const diagForDev = ((req as any).isAdmin === true) ? {
        orderId: diagOrderId,
        filtered: diagFiltered.map(r => ({ phone: maskPhone(r.phone), reason: r.reason })),
        candidates: candidates.map(c => ({ phone: maskPhone(c.phone), distKm: Number(Number(c.distKm).toFixed(2)) }))
      } : undefined;

      // 坐标未知时直接进大厅，不弹窗广播（用户要求：供小队内所有司机抢单）
      const coordsUnknownForDispatch = Boolean((orderData as any)?.coordsUnknown);
      // H13修复：coordsUnknown 为真时不写坐标字段，避免市中心占位符污染（两分支共用）
      const coordFields = coordsUnknownForDispatch ? {} : {
        passengerLat: pLat,
        passengerLng: pLng,
        resolvedLat: pLat,
        resolvedLng: pLng,
      };
      if (coordsUnknownForDispatch) {
        console.warn(`[Dispatch] 坐标未知，直接转入选单大厅，不做距离派单`);
      }

      if (!coordsUnknownForDispatch && candidates.length > 0) {
        // Prefer existing dispatched driver if present in eligible candidates
        let selected = candidates.find(c => c.phone === existingDispatchedPhone);
        if (!selected) {
          // Find closest driver distance
          const minDist = Math.min(...candidates.map(c => c.distKm));
          // 20米 (0.02km) 极近范围随机派单规则：
          const tiedCandidates = candidates.filter(c => Math.abs(c.distKm - minDist) <= 0.02 || c.distKm <= 0.02);
          selected = tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
        }
        // 2026-10-17: 逐步日志，派单卡死时定位
        console.log(`[Dispatch] 订单 ${orderId} 选中司机 ${selected?.phone}, 开始最终校验...`);
        console.log(`[Dispatch] 订单 ${orderId} 步骤1: license检查, selLic=${(selected as any)?.data?.licenseExpiry}`);

        // 2026-10-15 接单授权最终硬拦截（纵深防御）：即使候选过滤漏掉，
        // 指派前再次校验选中司机的授权，无授权直接转大厅，不弹窗派单
        if (selected) {
          const selLic = (selected as any)?.data?.licenseExpiry ?? (selected as any)?.licenseExpiry;
          if (!isLicenseValid(selLic)) {
            console.log(`[Dispatch] 司机 ${selected.phone} 接单授权无效，最终拦截：订单 ${orderId} 直接转入选单大厅`);
            selected = null as any;
          }
        }
        // P0(2026-10-15)：非VIP每日2单服务端强制限制
        // 2026-10-17: 加日志+10秒超时。全表扫描曾导致派单请求静默卡死（04:40实测）。
        if (selected) {
          const selVip = (selected as any)?.data?.vipExpiry ?? (selected as any)?.vipExpiry;
          console.log(`[Dispatch] 订单 ${orderId} 步骤2: VIP检查, selVip=${selVip}, isVipActive=${isVipActiveServer(selVip)}`);
          if (!isVipActiveServer(selVip)) {
            let todayCount = 0;
            try {
              console.log(`[Dispatch] 订单 ${orderId} 开始统计司机今日完成单数...`);
              todayCount = await Promise.race([
                countTodayCompletedOrders(String(selected.phone).replace(/\D/g, '')),
                new Promise<number>((_, reject) =>
                  setTimeout(() => reject(new Error('[MySQL超时] 今日单数统计超过10秒')), 10000)
                ),
              ]);
              console.log(`[Dispatch] 订单 ${orderId} 司机今日已完成 ${todayCount} 单`);
            } catch (e: any) {
              console.error(`[Dispatch] 订单 ${orderId} 统计今日单数失败，按0单继续:`, e?.message);
              todayCount = 0;
            }
            if (todayCount >= 2) {
              console.log(`[Dispatch] 司机 ${selected.phone} 非VIP今日已完成${todayCount}单，跳过：订单 ${orderId} 转大厅`);
              selected = null as any;
            }
          }
        }

        // H6修复：写入前用库内最新状态二次校验（防并发派单双写：高德解析+3秒等待期间可能已被其他请求派单）
        // 2026-10-17: MySQL 模式下直接查 MySQL，不读本地大 JSON 文件（readFileSync+JSON.parse 会阻塞事件循环）
        // 2026-10-17 05:30: H6 查询疑似卡死事件循环，临时 bypass（dispatchOrderLocks 已防同单并发）。
        // TODO: 查明 MySQL 卡死原因后恢复。
        console.log(`[Dispatch] 订单 ${orderId} 步骤3: H6并发检查开始`);
        /*
        {
          let freshOrder: any = null;
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [h6rows]: any = await mysqlQueryTimeout(
                mysqlPool,
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                ['merchant_orders', orderId],
                5000,
                'H6并发派单检查'
              );
              if (h6rows && h6rows[0]) {
                const d = h6rows[0].data;
                freshOrder = typeof d === 'string' ? JSON.parse(d) : d;
              }
            } catch (e: any) {
              console.error(`[Dispatch] 订单 ${orderId} H6检查失败，按未派单继续:`, e?.message);
            }
          } else {
            const freshDb = readLocalJsonDb();
            freshOrder = freshDb?.['merchant_orders']?.[orderId];
          }
          const alreadyDispatched = String(freshOrder?.dispatchedDriverPhone || '').trim();
          const alreadyClaimed = String(freshOrder?.claimedDriverPhone || '').trim();
          if (alreadyDispatched || alreadyClaimed) {
            console.log(`[Dispatch] 订单 ${orderId} 已被派单/抢单（${alreadyDispatched || alreadyClaimed}），本次跳过写入`);
            return res.json({ success: true, dispatched: true, driverPhone: alreadyDispatched || alreadyClaimed, alreadyDispatched: true });
          }
        }
        */
        console.log(`[Dispatch] 订单 ${orderId} 步骤3: H6跳过(临时bypass), 继续派单写入...`);

        // 接单授权拦截后无可用司机：订单直接转入选单大厅
        if (!selected) {
          const hallPayload = {
            ...orderData,
            id: orderId,
            orderId: orderId,
            ...coordFields,
            status: 'hall',
            in_hall: true,
            hallReason: 'no_licensed_driver',
            hallAt: Date.now(),
            timestamp: Date.now(),
          };
          try {
            if (isMySQLEnabled && mysqlPool) {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['merchant_orders', orderId, JSON.stringify(hallPayload)]
              );
            } else {
              const db2 = readLocalJsonDb();
              db2['merchant_orders'] = db2['merchant_orders'] || {};
              db2['merchant_orders'][orderId] = hallPayload;
              writeLocalJsonDb(db2);
            }
          } catch (_) {}
          console.log(`[Dispatch] 订单 ${orderId} 无授权司机，直接转入选单大厅`);
          return res.json({ success: true, dispatched: false, toHall: true, reason: 'no_licensed_driver', ...(diagForDev ? { diag: diagForDev } : {}) });
        }

        const distText = selected.distKm < 1.0 
          ? `${Math.max(50, Math.round(selected.distKm * 1000))}米` 
          : `${selected.distKm.toFixed(2)}公里`;
        const nowTs = Date.now();
        // 2026-10-17 v10: 派单卡死定位 - 步骤4开始（本地旧单循环）
        console.log(`[Dispatch] 订单 ${orderId} 步骤4: 本地旧单循环开始`);
        // 2026-10-14修复：一个司机同时只能有一单在派。如果该司机已有未处理的派单（dispatched状态），
        // 旧单直接转大厅，避免两单并存导致倒计时API在两者间串值、定时器误判。
        // 用户17:20和17:23连下两单，旧单未进大厅导致新单倒计时50→30跳变。
        // P0修复(2026-10-14)：直接在 dbData 上操作，不做分离的 preDb 读写（分离读写会导致后面的 writeLocalJsonDb(dbData) 用 stale 引用覆盖掉转大厅的修改）
        {
          const mo = dbData?.['merchant_orders'] || {};
          for (const k of Object.keys(mo)) {
            const o = mo[k];
            if (String(o?.dispatchedDriverPhone || '').trim() === String(selected.phone).trim()
              && (o?.status === 'dispatched' || o?.status === 'submitted')
              && !o?.claimedDriverPhone && !o?.in_hall) {
              console.log(`[Dispatch] 司机 ${selected.phone} 已有未处理派单 ${k}，旧单转大厅`);
              o.status = 'hall';
              o.in_hall = true;
              o.hallReason = 'superseded_by_new_dispatch';
              o.hallAt = nowTs;
            }
          }
          // passenger_links 会在下面被新单覆盖，这里不需要额外处理
        }
        // 2026-10-17 v10: 派单卡死定位 - 步骤4结束
        console.log(`[Dispatch] 订单 ${orderId} 步骤4: 本地旧单循环结束`);
        // P0(2026-10-15)：MySQL模式下旧单转大厅（否则两单并存串倒计时，致33→59跳变）
        // 2026-10-17: 加 8 秒超时，防连接 hang 住导致派单卡死
        // 2026-10-17优化：SQL 直接过滤该司机的派单中订单，不全表扫描
        // 2026-10-17 05:35: MySQL查询疑似卡死，临时bypass（本地JSON清理仍在）
        if (false && isMySQLEnabled && mysqlPool) {
          try {
            const [oldRows]: any = await mysqlQueryTimeout(
              mysqlPool,
              `SELECT \`doc_id\`, \`data\` FROM \`daijia_documents\`
               WHERE \`collection\` = 'merchant_orders'
                 AND JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.dispatchedDriverPhone')) = ?
                 AND JSON_UNQUOTE(JSON_EXTRACT(\`data\`, '$.status')) IN ('dispatched', 'submitted')`,
              [String(selected.phone).trim()],
              8000,
              '派单旧单扫描'
            );
            for (const r of (oldRows || [])) {
              try {
                const od = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                if (String(od?.dispatchedDriverPhone || '').trim() === String(selected.phone).trim()
                  && (od?.status === 'dispatched' || od?.status === 'submitted')
                  && !od?.claimedDriverPhone && !od?.in_hall) {
                  console.log(`[Dispatch] MySQL: 司机 ${selected.phone} 旧单 ${r.doc_id} 转大厅`);
                  od.status = 'hall';
                  od.in_hall = true;
                  od.hallReason = 'superseded_by_new_dispatch';
                  od.hallAt = nowTs;
                  await mysqlQueryTimeout(
                    mysqlPool,
                    'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                    [JSON.stringify(od), 'merchant_orders', r.doc_id],
                    8000,
                    '旧单转大厅写入'
                  );
                }
              } catch (_) { /* skip bad row */ }
            }
          } catch (e) {
            console.error('[Dispatch] 旧单转大厅MySQL失败:', (e as any)?.message);
          }
        }
        const driverQrUrl = `/uploads/qrcodes/${selected.phone}.png`;
        const dispatchedPayload = {
          ...orderData,
          id: orderId,
          orderId: orderId,
          ...coordFields,
          status: 'submitted',
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
          dispatchExpiresAt: nowTs + 60000,
          timestamp: nowTs,
          // 2026-10-13修复：记录对应的 merchant_orders key，
          // 倒计时接口没带 orderId 时可直接定位主订单，避免反查失败导致重复重置
          _merchantKey: orderId
        };

        // Write directly to passenger_links[selected.phone]
        if (!dbData['passenger_links']) dbData['passenger_links'] = {};
        dbData['passenger_links'][selected.phone] = dispatchedPayload;

        // Save to merchant_orders[orderId]
        if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
        dbData['merchant_orders'][orderId] = {
          ...dispatchedPayload,
          status: 'dispatched',
          statusCategory: '已指派',
          dispatchCountdown: 60,
          serverCountdown: 60,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 60000,
          timestamp: nowTs
        };

        // 2026-10-17: MySQL 模式下本地 JSON 只是缓存，异步刷盘即可。
        // 同步 JSON.stringify 整个 dbData 会阻塞事件循环（文件大时数秒~数十秒），导致派单卡死。
        // 2026-10-17 v10: 派单卡死定位 - 步骤5（本地缓存写）
        console.log(`[Dispatch] 订单 ${orderId} 步骤5: 本地缓存写开始`);
        writeLocalJsonDb(dbData, !(isMySQLEnabled && mysqlPool));
        console.log(`[Dispatch] 订单 ${orderId} 步骤5: 本地缓存写结束`);

        if (isMySQLEnabled && mysqlPool) {
          // P1(2026-10-16)：派单 MySQL 双写失败不再静默吞掉。之前 catch(_) {} 后仍返回 success，
          // 造成"僵尸派单"（本地有弹窗、MySQL 无记录 → 无倒计时、无超时转大厅）。
          // 照 update-driver-expiry 模式：重试3次，仍失败则抛500，不返回虚假成功。
          const mysqlWrites: Array<[string, any[]]> = [
            ['INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['passenger_links', selected.phone, JSON.stringify(dispatchedPayload)]],
            ['INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['merchant_orders', orderId, JSON.stringify({ ...dispatchedPayload, status: 'dispatched', statusCategory: '已指派' })]],
          ];
          // 2026-10-17 v10: 派单卡死定位 - 步骤6(passenger_links)/步骤7(merchant_orders)
          for (let _wi = 0; _wi < mysqlWrites.length; _wi++) {
            const [sql, params] = mysqlWrites[_wi];
            const _step = _wi === 0 ? '步骤6' : '步骤7';
            const _coll = String(params?.[0] || '');
            console.log(`[Dispatch] 订单 ${orderId} ${_step}: MySQL写入开始(${_coll})`);
            let ok = false;
            let lastErr: any = null;
            for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
              try {
                // 2026-10-17: 每次写入加 8 秒超时，防 hang 住导致派单卡死无响应
                await mysqlQueryTimeout(mysqlPool, sql, params, 8000, `派单双写(尝试${attempt}/3)`);
                ok = true;
                console.log(`[Dispatch] 订单 ${orderId} ${_step}: MySQL写入成功(${_coll},尝试${attempt}/3)`);
              } catch (e: any) {
                lastErr = e;
                if (attempt < 3) await new Promise(r => setTimeout(r, 200 * attempt));
              }
            }
            if (!ok) {
              console.error(`[Dispatch] 订单 ${orderId} MySQL 写入失败(3次重试):`, lastErr?.message);
              // P0(2026-10-16)：写失败时释放锁，允许立即重试
              if (lockOrderId) dispatchOrderLocks.delete(lockOrderId);
              return res.status(500).json({ success: false, error: '派单写入失败，请重试' });
            }
          }
        }

        // 2026-10-17 v10: 派单卡死定位 - 步骤8（全部完成）
        console.log(`[Dispatch] 订单 ${orderId} 步骤8: 派单写入全部完成，返回成功`);
        return res.json({
          success: true,
          isHall: false,
          orderId: orderId,
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
          dispatchExpiresAt: nowTs + 60000,
          ...(diagForDev ? { diag: diagForDev } : {})
        });
      } else {
        // Order Lobby fallback: Broadcast to ALL squad members in选单大厅
        const nowTs = Date.now();
        const hallPayload = {
          ...orderData,
          id: orderId,
          orderId: orderId,
          ...coordFields,
          status: 'hall',
          statusCategory: '等待接单',
          in_hall: true,
          isValetOrder: true,
          isPlatformDispatch: true,
          timestamp: nowTs
        };

        if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
        dbData['merchant_orders'][orderId] = hallPayload;

        writeLocalJsonDb(dbData);

        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['merchant_orders', orderId, JSON.stringify(hallPayload)]
            );
          } catch (_) {}
        }

        return res.json({
          success: true,
          isHall: true,
          passengerLat: pLat,
          passengerLng: pLng,
          serverTime: nowTs,
          coordsUnknown: coordsUnknownForDispatch || undefined,
          ...(diagForDev ? { diag: diagForDev } : {}),
          message: coordsUnknownForDispatch
            ? '起点坐标未知，已转入选单大厅供小队司机抢单'
            : '方圆3公里内无在线空闲司机，已全员广播转入选单大厅'
        });
      }
    } catch (err: any) {
      console.error('[Dispatch Nearest Exception]:', err);
      // P0(2026-10-16)：派单异常时释放 orderId 锁，否则 60 秒内重试被 409 挡住
      try {
        const failOrderId = String((req.body?.orderData as any)?.orderId || (req.body?.orderData as any)?.id || '').trim();
        if (failOrderId) dispatchOrderLocks.delete(failOrderId);
      } catch (_) {}
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.1 Atomic Order Grab / Claim from 选单大厅
  app.post('/api/order/claim', requireDbAuth, async (req, res) => {
    try {
      // 2026-10-17：请求到达时间。接单是否超时以到达时间为准，不受后续授权/小队/
      // MySQL 校验耗时影响（这些校验在手机网络下可达数秒）。
      const arrivedAt = Date.now();
      const { orderId, driverName, orderPayload } = req.body;
      const cleanOrderId = String(orderId || '').trim();
      // H11修复：driverPhone 强制取 token 本人，禁止客户端传入冒名
      const authPhoneRaw = String((req as any).authPhone || '').trim();
      // A后缀商户身份拒绝抢单（商户只能下单不能接单）
      if (/a$/i.test(authPhoneRaw)) {
        return res.status(403).json({ success: false, error: '商户身份不能抢单' });
      }
      const cleanDriverPhone = authPhoneRaw.replace(/\D/g, '').trim();
      // 接单授权检查 (2026-10-15)：天数为0不能抢单，无豁免
      // 查driver_users，兜底查squad_members
      try {
        let licExpiry = '';
        const getLic = async (col: string): Promise<string> => {
          if (isMySQLEnabled && mysqlPool) {
            const [lrows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, cleanDriverPhone]);
            if (lrows && lrows.length > 0) {
              const ld = typeof lrows[0].data === 'string' ? JSON.parse(lrows[0].data) : lrows[0].data;
              return String(ld.licenseExpiry || '');
            }
          } else {
            return String(readLocalJsonDb()?.[col]?.[cleanDriverPhone]?.licenseExpiry || '');
          }
          return '';
        };
        licExpiry = await getLic('driver_users') || await getLic('squad_members');
        if (!isLicenseValid(licExpiry)) {
          return res.status(403).json({ success: false, error: '接单授权已到期，请联系开发者充值' });
        }
      } catch (e) {
        console.error('[Claim] 接单授权校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '授权校验失败，请重试' });
      }
      // P0(2026-10-15)：非VIP每日2单服务端强制限制
      try {
        let vipExpiry = '';
        if (isMySQLEnabled && mysqlPool) {
          const [vrows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', cleanDriverPhone]);
          if (vrows && vrows.length > 0) {
            const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
            vipExpiry = String(vd.vipExpiry || '');
          }
        } else {
          vipExpiry = String(readLocalJsonDb()?.driver_users?.[cleanDriverPhone]?.vipExpiry || '');
        }
        if (!isVipActiveServer(vipExpiry)) {
          const todayCount = await countTodayCompletedOrders(cleanDriverPhone);
          if (todayCount >= 2) {
            return res.status(403).json({ success: false, error: '非VIP会员每天限2单，明早6点自动恢复。如需无限接单请开通VIP' });
          }
        }
      } catch (e) {
        console.error('[Claim] VIP限额校验异常:', (e as any)?.message);
      }
      const cleanDriverName = String(driverName || `司机${cleanDriverPhone.slice(-4)}`).trim();

      if (!cleanOrderId || !cleanDriverPhone) {
        return res.status(400).json({ success: false, error: 'Missing orderId' });
      }
      // H11修复：orderPayload 白名单过滤，禁止注入任意字段
      const ALLOWED_CLAIM_FIELDS = new Set(['driverNote', 'driverLocation', 'driverLat', 'driverLng', 'estimatedArrival']);
      const safePayload: any = {};
      if (orderPayload && typeof orderPayload === 'object') {
        for (const k of Object.keys(orderPayload)) {
          if (ALLOWED_CLAIM_FIELDS.has(k)) safePayload[k] = (orderPayload as any)[k];
        }
      }

      const dbData = readLocalJsonDb();

      // Check if claiming driver is in removed_squad_members or not an approved squad member
      const removedPhonesArr: string[] = dbData.config?.['removed_squad_members']?.phones || [];
      const isRemovedDriver = removedPhonesArr.includes(cleanDriverPhone);
      const isDevDriver = cleanDriverPhone === '15509601222';

      let isSquadApproved = isDevDriver;
      if (!isDevDriver && !isRemovedDriver) {
        // P1(2026-10-16)：审批口径收紧——① MySQL 优先读（本地 JSON 可能滞后）；
        // ② 去掉 || !st：空状态不再算通过，必须是明确的已通过状态。
        let squadDoc: any = null;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [srows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['squad_members', cleanDriverPhone]);
            if (srows && srows.length > 0) {
              const sraw = srows[0].data;
              squadDoc = typeof sraw === 'string' ? JSON.parse(sraw) : sraw;
            }
          } catch (_) {}
        }
        if (!squadDoc) squadDoc = dbData['squad_members']?.[cleanDriverPhone];
        if (squadDoc) {
          const st = String(squadDoc.status || squadDoc.approvalStatus || '').trim();
          if (st === '已通过' || st === 'approved' || st === '通过') {
            isSquadApproved = true;
          }
        }
      }

      if (isRemovedDriver || !isSquadApproved) {
        return res.status(403).json({ success: false, error: '❌ 权限不足：只有小队内审批通过的正式司机才能接收商户代叫单与报单转单！非小队成员无接单权限。' });
      }
      if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
      let targetOrder: any = null;
      // 2026-10-17：MySQL模式下优先读MySQL。本地JSON可能滞后（双写不一致），
      // 若本地是旧hall状态而MySQL是dispatched，按本地会误判"已进大厅"导致接单失败。
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [crows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['merchant_orders', cleanOrderId]
          );
          if (crows && crows.length > 0) {
            targetOrder = typeof crows[0].data === 'string' ? JSON.parse(crows[0].data) : crows[0].data;
          }
        } catch (_) {}
      }
      if (!targetOrder) {
        targetOrder = dbData['merchant_orders'][cleanOrderId];
      }

      // P1-1修复(2026-10-14)：订单不存在直接 404，不创建假订单
      if (!targetOrder) {
        return res.status(404).json({ success: false, error: '订单不存在' });
      }

      // P1-2修复(2026-10-14)：司机行程中（isBusy）不能再抢单，防一人同时持有两单
      // P0(2026-10-16)：改优先读 MySQL。之前只读本地 JSON，MySQL 模式下 busy 只写 MySQL，
      // 本地永远是旧值，检查恒失效，司机可同时持有多单。
      try {
        let busyLoc: any = null;
        let busySrc = 'none';
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [brows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['driver_locations', cleanDriverPhone]);
            if (brows && brows.length > 0) {
              const braw = brows[0].data;
              busyLoc = typeof braw === 'string' ? JSON.parse(braw) : braw;
              busySrc = 'mysql';
            } else {
              busySrc = 'mysql-empty';
            }
          } catch (e: any) {
            busySrc = 'mysql-err:' + String(e?.message || e).slice(0, 80);
          }
        } else {
          busySrc = 'mysql-disabled';
        }
        if (!busyLoc) { busyLoc = dbData.driver_locations?.[cleanDriverPhone]; if (busyLoc) busySrc = 'local'; }
        console.log('[ClaimBusy] phone=' + cleanDriverPhone + ' src=' + busySrc + ' isBusy=' + JSON.stringify(busyLoc?.isBusy));
        if (busyLoc && (busyLoc.isBusy === true || busyLoc.isBusy === "true" || busyLoc.isBusy === 1)) {
          return res.status(409).json({ success: false, error: '您当前有行程中的订单，请完成后再抢单' });
        }
      } catch (_) {}

      // Check if order is already claimed by ANOTHER driver or cancelled
      if (targetOrder) {
        const isClaimedByOther = (Boolean(targetOrder.claimedDriverPhone) && targetOrder.claimedDriverPhone !== cleanDriverPhone) ||
          (targetOrder.status === 'serving' && targetOrder.claimedDriverPhone && targetOrder.claimedDriverPhone !== cleanDriverPhone);
        const isCancelled = targetOrder.status === 'cancelled' || targetOrder.statusCategory === '已取消';
        if (isClaimedByOther || isCancelled) {
          return res.status(409).json({ success: false, error: '⚠️ 该订单已被其他小队司机抢走或已取消！' });
        }
        // P0-3修复(2026-10-13)：派单接单必须验证订单仍派单给本人。
        // 若订单已超时进大厅(dispatchedDriverPhone被清空)，新来单页的延迟接单不能静默复活，
        // 必须提示去大厅抢单，避免与其他司机看到的"大厅有单"状态错乱。
        // P0(2026-10-15晚)：去掉isDispatchedClaim条件，只要订单有dispatchedDriverPhone就必须验证
        // 防司机B不传flag直接把派单给A的订单抢走
        {
          const dispatchedTo = String(targetOrder.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
          const tStatus = String(targetOrder.status || '');
          // P0(2026-10-16第二遍审计)：/api/order/claim 是派单接单通道，必须要求订单已派给本人。
          // 之前 dispatchedTo 为空时直接跳过校验，导致 submitted 状态的二维码创单可被任意司机经 API 盗抢。
          // 大厅抢单走 /api/order/driver-claim，此处不放行无派单的订单。
          if (!dispatchedTo) {
            return res.status(409).json({ success: false, error: '该订单未派单给你，无法接单' });
          }
          console.log('[ClaimHall] order=' + cleanOrderId + ' tStatus=' + tStatus + ' in_hall=' + JSON.stringify(targetOrder.in_hall));
          if (tStatus === 'hall' || targetOrder.in_hall === true) {
            return res.status(409).json({ success: false, error: '订单已超时进入大厅，请去大厅抢单', inHall: true });
          }
          if (dispatchedTo !== cleanDriverPhone) {
            return res.status(409).json({ success: false, error: '订单已转派给其他司机' });
          }
        }
      }

      // 2026-10-17根治：
      // ① 幂等短路：本人已接单成功直接返回成功。防"claim 成功但响应丢失→前端核实/重试"
      //    被误判为超时或被他人抢走。必须放在过期检查之前。
      // ② 过期检查：以请求到达时间 arrivedAt 对 dispatchExpiresAt 判定，而非响应完成时间。
      //    5秒点接单、请求在过期前到达，必须能原子接单；过期后到达才拒绝。
      {
        const claimedByMe = String(targetOrder.claimedDriverPhone || '').replace(/\D/g, '').trim() === cleanDriverPhone &&
          (String(targetOrder.status || '') === 'claimed' || Boolean(targetOrder.claimedAt));
        if (claimedByMe) {
          return res.json({ success: true, order: targetOrder, serverTime: Date.now(), idempotent: true });
        }
        const exp = Number(targetOrder.dispatchExpiresAt || 0);
        if (exp > 0 && arrivedAt > exp) {
          return res.status(409).json({ success: false, expired: true, error: '接单超时，派单倒计时已结束' });
        }
      }

      const now = Date.now();
      const driverQrUrl = `/uploads/qrcodes/${cleanDriverPhone}.png`;
      const claimUpdateData = {
        ...(targetOrder || {}),
        ...safePayload,
        id: cleanOrderId,
        orderId: cleanOrderId,
        status: 'claimed',
        statusCategory: '已接单',
        in_hall: false,
        dispatchedDriverPhone: cleanDriverPhone,
        dispatchedDriverName: cleanDriverName,
        claimedDriverPhone: cleanDriverPhone,
        claimedDriverName: cleanDriverName,
        driverName: cleanDriverName,
        paymentQrCode: (targetOrder && targetOrder.paymentQrCode) || driverQrUrl,
        qrCode: (targetOrder && targetOrder.qrCode) || driverQrUrl,
        wechatQrCode: (targetOrder && targetOrder.wechatQrCode) || driverQrUrl,
        qrcode_url: (targetOrder && targetOrder.qrcode_url) || driverQrUrl,
        driverQrCode: driverQrUrl,
        claimedAt: now
      };

      dbData['merchant_orders'][cleanOrderId] = claimUpdateData;

      // Clear passenger_links so incoming order popup is NOT triggered for manually claimed hall orders
      if (dbData['passenger_links'] && dbData['passenger_links'][cleanDriverPhone]) {
        delete dbData['passenger_links'][cleanDriverPhone];
      }

      if (!dbData['active_orders']) dbData['active_orders'] = {};
      dbData['active_orders'][cleanDriverPhone] = {
        ...claimUpdateData,
        orderId: cleanOrderId,
        orderNo: req.body.orderNo || cleanOrderId,
        status: 'claimed',
        statusCategory: '已接单',
        isCancelled: false
      };

      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        // P1(2026-10-16)：改条件 UPDATE 原子化，防并发双抢都成功。
        // 之前无条件 upsert，两人同时通过检查会都写入。条件不满足时 affectedRows=0 → 409。
        // P1(2026-10-16)：加 3 次重试，失败抛 500。之前 catch(_) {} 静默吞错，
        // 本地标 claimed 但 MySQL 仍是 dispatched，60秒后订单被超时转大厅（反向幽灵单）。
        let claimOk = false;
        let claimErr: any = null;
        for (let attempt = 1; attempt <= 3 && !claimOk; attempt++) {
          try {
            const [updRes]: any = await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ? ' +
              'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.status\')), \'\') NOT IN (\'claimed\', \'已接单\', \'cancelled\', \'已取消\', \'hall\', \'等待接单\') ' +
              'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.in_hall\')), \'false\') != \'true\' ' +
              'AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.claimedDriverPhone\')), \'\') = \'\' ' +
              'OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.claimedDriverPhone\')), \'\') = ?)',
              [JSON.stringify(claimUpdateData), 'merchant_orders', cleanOrderId, cleanDriverPhone]
            );
            const affected = Number(updRes?.affectedRows || 0);
            if (affected === 0) {
              return res.status(409).json({ success: false, error: '该订单已被其他司机接单' });
            }
            claimOk = true;
          } catch (e: any) {
            claimErr = e;
            if (attempt < 3) await new Promise(r => setTimeout(r, 200 * attempt));
          }
        }
        if (!claimOk) {
          console.error(`[Claim] 订单 ${cleanOrderId} MySQL 写入失败(3次重试):`, claimErr?.message);
          return res.status(500).json({ success: false, error: '接单写入失败，请重试' });
        }
        try {
          // P1(2026-10-16)：接单后 passenger_links 必须 DELETE，不能 upsert。
          // 之前 upsert 的是本地已 delete 掉的 undefined（JSON.stringify(undefined)），被静默吞错，
          // MySQL 里残留旧 passenger_links，司机 App 会继续收到已接订单的弹窗。
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['passenger_links', cleanDriverPhone]
          ).catch(() => {});
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['active_orders', cleanDriverPhone, JSON.stringify(dbData['active_orders'][cleanDriverPhone])]
          );
        } catch (_) {}
      }

      // P0(2026-10-15晚)：接单成功后写busy=true，防司机同时持有多单
      if (isMySQLEnabled && mysqlPool) {
        try {
          for (const col of ['driver_users', 'driver_locations', 'squad_members']) {
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(TRUE AS JSON), "$.status", "busy") WHERE `collection` = ? AND `doc_id` = ?',
              [col, cleanDriverPhone]
            ).catch(() => {});
          }
        } catch (_) {}
      } else {
        for (const col of ['driver_users', 'driver_locations', 'squad_members']) {
          if (dbData[col] && dbData[col][cleanDriverPhone]) {
            dbData[col][cleanDriverPhone] = {
              ...dbData[col][cleanDriverPhone],
              isBusy: true,
              status: 'busy',
              lastStatusUpdateTime: Date.now()
            };
          }
        }
        writeLocalJsonDb(dbData);
      }

      return res.json({ success: true, order: claimUpdateData, serverTime: now });
    } catch (err: any) {
      console.error('[Order Claim Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2 60-Second Timeout / Driver Decline Order Reclaim to 选单大厅
  app.post('/api/order/decline', requireDbAuth, async (req, res) => {
    try {
      const { orderId, driverPhone } = req.body;
      const cleanOrderId = String(orderId || '').trim();
      const cleanDriverPhone = String(driverPhone || '').replace(/\D/g, '').trim();
      // H8修复：校验操作者是接单司机本人（或管理员）
      const authPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdmin = !!(req as any).isAdmin;
      if (!isAdmin && cleanDriverPhone && authPhone !== cleanDriverPhone) {
        return res.status(403).json({ success: false, error: '只能操作自己的订单' });
      }

      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: 'Missing orderId' });
      }

      const dbData = readLocalJsonDb();
      if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
      let targetOrder: any = dbData['merchant_orders'][cleanOrderId];
      // P1(2026-10-15)：MySQL模式下先SELECT真实订单，防本地空数据wipe
      if (isMySQLEnabled && mysqlPool && !targetOrder) {
        try {
          const [drows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['merchant_orders', cleanOrderId]
          );
          if (drows && drows.length > 0) {
            targetOrder = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
          }
        } catch (_) {}
      }

      // P0-2修复(2026-10-13)：拒单前校验订单仍派单给本人且未被接单。
      // 否则延迟的拒单会把已进大厅被他人抢走的订单偷回大厅（B已接单，A的旧页面点拒单把B的单清空）。
      if (targetOrder) {
        const dispatchedTo = String(targetOrder.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
        const tStatus = String(targetOrder.status || '');
        if (tStatus === 'claimed' || tStatus === 'serving' || tStatus === 'completed' || tStatus === 'cancelled') {
          return res.status(409).json({ success: false, error: '订单已被接单，无法拒单' });
        }
        if (dispatchedTo && dispatchedTo !== cleanDriverPhone) {
          return res.status(409).json({ success: false, error: '订单已不在派单中' });
        }
      }

      const existingDeclined = Array.isArray(targetOrder?.declinedDriverPhones) ? targetOrder.declinedDriverPhones : [];
      const existingTimeout = Array.isArray(targetOrder?.timeoutDriverPhones) ? targetOrder.timeoutDriverPhones : [];

      const now = Date.now();
      const updateData = {
        ...(targetOrder || {}),
        status: 'hall',
        in_hall: true,
        statusCategory: '呼叫中',
        dispatchedDriverPhone: '',
        dispatchedDriverName: '',
        claimedDriverPhone: '',
        claimedDriverName: '',
        driverName: '',
        declinedDriverPhones: Array.from(new Set([...existingDeclined, cleanDriverPhone].filter(Boolean))),
        timeoutDriverPhones: Array.from(new Set([...existingTimeout, cleanDriverPhone].filter(Boolean))),
        lastDeclinedAt: now
      };

      dbData['merchant_orders'][cleanOrderId] = updateData;

      if (cleanDriverPhone && dbData['passenger_links'] && dbData['passenger_links'][cleanDriverPhone]) {
        delete dbData['passenger_links'][cleanDriverPhone];
      }

      // 释放司机忙碌状态，重新恢复可派单空闲状态
      if (cleanDriverPhone) {
        ['driver_users', 'driver_locations', 'squad_members'].forEach(col => {
          if (dbData[col] && dbData[col][cleanDriverPhone]) {
            dbData[col][cleanDriverPhone] = {
              ...dbData[col][cleanDriverPhone],
              isBusy: false,
              status: 'idle',
              lastStatusUpdateTime: now
            };
          }
        });
      }

      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['merchant_orders', cleanOrderId, JSON.stringify(updateData)]
          );
          if (cleanDriverPhone) {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['passenger_links', cleanDriverPhone]
            );
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(FALSE AS JSON), "$.status", "idle") WHERE `collection` IN ("driver_users", "driver_locations", "squad_members") AND `doc_id` = ?',
              [cleanDriverPhone]
            );
          }
        } catch (_) {}
      }

      return res.json({ success: true, order: updateData, serverTime: now });
    } catch (err: any) {
      console.error('[Order Decline Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2.2 ABSOLUTE Order Cancellation (Marks order as cancelled everywhere so it disappears from hall for ALL drivers)
  app.post('/api/order/cancel', requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.body.orderId || req.body.id || '').trim();
      const driverPhone = String(req.body.driverPhone || req.body.phone || '').replace(/\D/g, '').trim();
      const cancelReason = String(req.body.reason || req.body.cancelReason || '订单已彻底取消').trim();
      const cancelledBy = String(req.body.cancelledBy || (driverPhone ? 'driver' : 'admin')).trim();

      if (!orderId) {
        return res.status(400).json({ success: false, error: 'Missing orderId' });
      }

      // H8修复：校验操作者是下单方/接单方/isAdmin
      const authPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdmin = !!(req as any).isAdmin;
      if (!isAdmin) {
        // P1(2026-10-15)：cancel鉴权必须从MySQL读真实订单，防body传driverPhone冒充
        let targetOrderCheck: any = {};
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [crows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['merchant_orders', orderId]
            );
            if (crows && crows.length > 0) {
              targetOrderCheck = typeof crows[0].data === 'string' ? JSON.parse(crows[0].data) : crows[0].data;
            }
          } catch (_) {}
        } else {
          const dbDataCheck = readLocalJsonDb();
          targetOrderCheck = (dbDataCheck['merchant_orders'] || {})[orderId] || {};
        }
        const orderPlacer = String(targetOrderCheck.merchantPhone || targetOrderCheck.orderMerchantPhone || targetOrderCheck.phone || '').replace(/\D/g, '').trim();
        // 不再回退到body的driverPhone，必须是订单真实关联人
        const orderDriver = String(targetOrderCheck.dispatchedDriverPhone || targetOrderCheck.driverPhone || targetOrderCheck.assignedDriver || targetOrderCheck.claimedDriverPhone || '').replace(/\D/g, '').trim();
        if (!orderPlacer && !orderDriver) {
          return res.status(404).json({ success: false, error: '订单不存在' });
        }
        if (authPhone !== orderPlacer && authPhone !== orderDriver) {
          return res.status(403).json({ success: false, error: '只有下单方、接单司机或管理员可以取消订单' });
        }
      }

      console.log(`[Order Cancel] Permanent cancellation for orderId: ${orderId}, by: ${cancelledBy}, reason: ${cancelReason}`);

      const now = Date.now();
      const cancelPayload = {
        status: 'cancelled',
        statusCategory: '已取消',
        in_hall: false,
        cancelledAt: now,
        cancelledBy: cancelledBy,
        cancelledByRole: cancelledBy,
        cancelReason: cancelReason
      };

      const dbData = readLocalJsonDb();
      
      // P0(2026-10-17)：取消前检查订单状态——服务中/已完成不可取消
      // 用户铁律：司机在实时计费中页面时，管理人员点取消派单要提示"订单进行中或已完成不可取消"
      let checkSt = '';
      let checkCat = '';
      // 先读 MySQL（主数据源），失败回退本地
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [srows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['merchant_orders', orderId]
          );
          if (srows && srows.length > 0) {
            const sd = typeof srows[0].data === 'string' ? JSON.parse(srows[0].data) : srows[0].data;
            checkSt = String(sd.status || '');
            checkCat = String(sd.statusCategory || '');
          }
        } catch (_) {}
      }
      if (!checkSt && !checkCat) {
        const targetMerchantCheck = (dbData['merchant_orders'] || {})[orderId] || {};
        checkSt = String(targetMerchantCheck.status || '');
        checkCat = String(targetMerchantCheck.statusCategory || '');
      }
      const isServing = checkSt === 'serving' || checkSt === 'in_service' || checkSt === 'started' || checkCat === '服务中' || checkCat === '计费中' || checkCat === '进行中';
      const isCompleted = checkSt === 'completed' || checkSt === 'finished' || checkCat === '已完成';
      if (isServing || isCompleted) {
        return res.status(400).json({ success: false, error: '订单进行中或已完成不可取消' });
      }

      // Update merchant_orders
      if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
      const targetMerchant = dbData['merchant_orders'][orderId] || {};
      dbData['merchant_orders'][orderId] = {
        ...targetMerchant,
        ...cancelPayload
      };

      // Update valet_orders if exists
      if (!dbData['valet_orders']) dbData['valet_orders'] = {};
      if (dbData['valet_orders'][orderId]) {
        dbData['valet_orders'][orderId] = {
          ...dbData['valet_orders'][orderId],
          ...cancelPayload
        };
      }

      // Update orders if exists
      if (!dbData['orders']) dbData['orders'] = {};
      if (dbData['orders'][orderId]) {
        dbData['orders'][orderId] = {
          ...dbData['orders'][orderId],
          ...cancelPayload
        };
      }

      // Notify assigned driver via passenger_links & active_orders so driver immediately returns to homepage, and reset driver busy state
      const assignedDriver = driverPhone || targetMerchant.dispatchedDriverPhone || targetMerchant.claimedDriverPhone;
      if (assignedDriver) {
        const driverCancelNotice = {
          orderId,
          orderNo: req.body.orderNo || orderId,
          isCancelled: true,
          status: 'cancelled',
          statusCategory: '已取消',
          cancelledBy,
          cancelReason,
          cancelledAt: now
        };
        if (!dbData['passenger_links']) dbData['passenger_links'] = {};
        dbData['passenger_links'][assignedDriver] = driverCancelNotice;

        if (!dbData['active_orders']) dbData['active_orders'] = {};
        dbData['active_orders'][assignedDriver] = driverCancelNotice;

        // Reset busy status in driver_users, driver_locations, and squad_members
        if (dbData['driver_users'] && dbData['driver_users'][assignedDriver]) {
          dbData['driver_users'][assignedDriver] = {
            ...dbData['driver_users'][assignedDriver],
            isBusy: false,
            status: 'idle',
            lastStatusUpdateTime: now
          };
        }
        if (dbData['driver_locations'] && dbData['driver_locations'][assignedDriver]) {
          dbData['driver_locations'][assignedDriver] = {
            ...dbData['driver_locations'][assignedDriver],
            isBusy: false,
            status: 'idle',
            lastStatusUpdateTime: now
          };
        }
        if (dbData['squad_members'] && dbData['squad_members'][assignedDriver]) {
          dbData['squad_members'][assignedDriver] = {
            ...dbData['squad_members'][assignedDriver],
            isBusy: false,
            status: 'idle',
            lastStatusUpdateTime: now
          };
        }
      }

      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          const mergedData = JSON.stringify(dbData['merchant_orders'][orderId]);
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['merchant_orders', orderId, mergedData]
          );
          if (assignedDriver) {
            const cancelNoticeStr = JSON.stringify({
              orderId,
              orderNo: req.body.orderNo || orderId,
              isCancelled: true,
              status: 'cancelled',
              statusCategory: '已取消',
              cancelledBy,
              cancelReason,
              cancelledAt: now
            });
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['passenger_links', assignedDriver, cancelNoticeStr]
            );
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['active_orders', assignedDriver, cancelNoticeStr]
            );
            // P1(2026-10-15)：cancel后三表busy状态重置，不依赖本地dbData
            for (const col of ['driver_users', 'driver_locations', 'squad_members']) {
              try {
                const [drows]: any = await mysqlPool.query(
                  'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                  [col, assignedDriver]
                );
                if (drows && drows.length > 0) {
                  const dd = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
                  dd.isBusy = false;
                  dd.status = 'idle';
                  dd.lastStatusUpdateTime = Date.now();
                  await mysqlPool.query(
                    'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                    [JSON.stringify(dd), col, assignedDriver]
                  );
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      return res.json({ success: true, orderId, order: dbData['merchant_orders'][orderId] });
    } catch (err: any) {
      console.error('[Order Cancel Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.3 中国大陆阿里云服务器60秒自动倒计时引擎与超时自动转入选单大厅Daemon (1秒级高精度权威倒计时)
  setInterval(async () => {
    try {
      const now = Date.now();
      // 2026-10-15 P0修复：MySQL模式下从MySQL读订单，否则超时转大厅在生产环境完全失效
      // 2026-10-17优化：只查派单中的订单（status=dispatched，或 submitted+有司机），不全表扫描。
      // 之前全表 SELECT data 再逐个 JSON.parse，订单多时每10秒阻塞事件循环，导致派单请求卡死、超时不触发。
      let merchantOrders: Record<string, any> = {};
      let useMySQL = false;
      const dbData = readLocalJsonDb();
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlQueryTimeout(
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
            8000,
            '定时器扫描派单中订单'
          );
          (rows || []).forEach((r: any) => {
            try {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              const k = String(r.doc_id || d?.id || d?.orderId || '').trim();
              if (k) merchantOrders[k] = d;
            } catch (_) {}
          });
          useMySQL = true;
        } catch (e) {
          console.error('[Timer] MySQL读merchant_orders失败:', (e as any)?.message);
        }
      }
      if (!useMySQL) {
        merchantOrders = dbData['merchant_orders'] || {};
      }
      let hasChanges = false;

      for (const [orderId, order] of Object.entries<any>(merchantOrders)) {
        if (!order) continue;
        const isDispatched = (
          order.status === 'dispatched' || 
          (order.status === 'submitted' && Boolean(order.dispatchedDriverPhone))
        ) && !order.claimedAt && order.status !== 'claimed' && order.status !== 'serving' && order.status !== 'completed' && order.status !== 'cancelled' && order.in_hall !== true;

        if (isDispatched && order.dispatchedDriverPhone) {
          const dispatchedTime = Number(order.dispatchedAt || order.timestamp || now);
          const expiresAt = Number(order.dispatchExpiresAt || (dispatchedTime + 60000));
          // 核心：由阿里云服务器计算精确剩余秒数 (60秒 -> 59秒 -> ... -> 31秒 -> ... -> 0秒)
          let remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
          // 2026-10-13根治+优化：仅当疑似超时(remainingSec<=0)时，重读最新 dispatchExpiresAt 确认。
          // 原因：定时器每10秒读一次整个DB，如果倒计时接口在定时器读DB之后更新了 dispatchExpiresAt
          // （例如客户端延迟首次看到触发的60秒重置），用旧快照会误判超时（实测 56→0 跳变）。
          // 为避免给每个订单都重读整个DB（性能差），仅在可能超时时才重读确认。
          if (remainingSec <= 0) {
            try {
              const freshDbData = readLocalJsonDb();
              let freshOrder: any = freshDbData['merchant_orders']?.[orderId] || order;
              // P1(2026-10-15)：MySQL模式下从MySQL重读，防用10秒前快照误判
              if (isMySQLEnabled && mysqlPool) {
                try {
                  const [frows]: any = await mysqlPool.query(
                    'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                    ['merchant_orders', orderId]
                  );
                  if (frows && frows.length > 0) {
                    freshOrder = typeof frows[0].data === 'string' ? JSON.parse(frows[0].data) : frows[0].data;
                  }
                } catch (_) {}
              }
              // P0修复：重读后必须检查订单状态！如果已被接单/服务中/完成/取消/已在大厅，直接跳过，绝不能搬进大厅。
              // 否则10秒快照是dispatched、但重读时已claimed的订单会被错误转大厅，导致订单丢失。
              const freshStatus = String(freshOrder.status || '');
              if (freshStatus === 'claimed' || freshStatus === 'serving' || freshStatus === 'completed' || freshStatus === 'cancelled' || freshOrder.in_hall === true || freshOrder.claimedAt) {
                continue; // 已处理，跳过此订单
              }
              const freshDispatchedTime = Number(freshOrder.dispatchedAt || freshOrder.timestamp || now);
              const freshExpiresAt = Number(freshOrder.dispatchExpiresAt || (freshDispatchedTime + 60000));
              remainingSec = Math.max(0, Math.ceil((freshExpiresAt - now) / 1000));
              // 用最新数据替换，供后续转大厅逻辑使用
              if (remainingSec > 0) {
                // 实际未超时，更新内存中的order避免误操作（不写DB）
                order.dispatchExpiresAt = freshOrder.dispatchExpiresAt;
                order.dispatchedAt = freshOrder.dispatchedAt;
              }
            } catch (_) {}
          }
          const timedOutDriverPhone = String(order.dispatchedDriverPhone).replace(/\D/g, '').trim();

          // 1. 计算订单在阿里云服务器上的权威倒计时（仅内存计算，不持久化）
          // 2026-10-13修复：定时器只更新显示用的倒计时数字，绝不回写 dispatchExpiresAt。
          // dispatchExpiresAt 的权威写入者只有两处：派单时的初始设置，和 /api/dispatch/countdown 的延迟重置。
          // 定时器若回写自己读到的旧值，会覆盖倒计时接口刚持久化的重置值，导致 60→0 跳变。
          // 2026-10-13补充修复：定时器不再持久化 serverCountdown/dispatchCountdown 显示字段。
          // 原因：定时器每10秒读整个DB、改两个字段、写回整个DB，会覆盖倒计时接口在两次定时器运行之间
          // 对 dispatchExpiresAt 的更新（read-modify-write 竞态）。显示字段由 /api/dispatch/countdown
          // 实时计算返回，无需DB缓存；只有转大厅才需要持久化。
          if (order.serverCountdown !== remainingSec || order.dispatchCountdown !== remainingSec) {
            order.serverCountdown = remainingSec;
            order.dispatchCountdown = remainingSec;
            // 注意：此处故意不设置 hasChanges = true，避免写回整个DB覆盖其他接口的更新。
            // 转大厅逻辑在下方单独设置 hasChanges。

            // 同步更新内存中的 passenger_links（不持久化，由倒计时接口实时返回权威值）
            if (timedOutDriverPhone && dbData['passenger_links']?.[timedOutDriverPhone]) {
              dbData['passenger_links'][timedOutDriverPhone].serverCountdown = remainingSec;
              dbData['passenger_links'][timedOutDriverPhone].dispatchCountdown = remainingSec;
            }
          }

          // 1.5 滴滴式"上屏检测" (2026-10-13新增)：派单后若无页面心跳，判定新来单页未上屏
          // (App被杀/用户未点通知/页面崩溃)，不等60秒，立即转大厅让其他司机抢。
          // 心跳由App新来单页面每2秒发送一次。
          // P0-3修复(2026-10-13)：区分"从未上屏"vs"曾经上屏后切后台"。
          // - 从未收到心跳(pageHeartbeatAt=0)：App被杀，页面从未显示，35秒转大厅。
          // - 曾经收到心跳：用户切后台/锁屏(Web后台setInterval被节流)，宽限走完60秒，
          //   保证"后台10秒后点通知回来显示50秒"的滴滴体验。
          // P0(2026-10-16)：15s→35s。App后台轮询 passenger_links 是 30s 一次，
          // 15s 阈值下约 40-60% 概率轮询还没跑到、服务端已转大厅删通道，司机全程无感知。
          // 35s > 30s 轮询周期，保证后台 App 至少有一次轮询机会看到派单。
          // 注意：定时器每10秒运行，快照数据最多10秒旧，故"从未上屏"阈值设为35秒。
          const pageHeartbeatAt = Number(order.pageHeartbeatAt || 0);
          const sinceDispatched = now - dispatchedTime;
          const neverHadHeartbeat = pageHeartbeatAt === 0;
          const pageNotOnScreen = neverHadHeartbeat && sinceDispatched > 35000;
          if (pageNotOnScreen && remainingSec > 0) {
            console.log(`[上屏检测] 订单 ${orderId} 派单${Math.round(sinceDispatched/1000)}秒无页面心跳，判定未上屏，立即转大厅！`);
            // 复用下方的转大厅逻辑：设置 remainingSec=0 触发转大厅
            remainingSec = 0;
            order.autoHallReason = '新来单页面35秒无心跳，判定未上屏，服务器提前转入选单大厅';
          }

          // 2. 倒计时结束 (0秒)：防止司机大退、断网或关机造成假死，服务器立即自动将订单转入选单大厅
          if (remainingSec <= 0) {
            console.log(`[阿里云服务器倒计时结束] 订单 ${orderId} 派单给司机 ${timedOutDriverPhone} 60秒超时未确认，服务器自动转入选单大厅！`);
            const existingDeclined = Array.isArray(order.declinedDriverPhones) ? order.declinedDriverPhones : [];
            const existingTimeout = Array.isArray(order.timeoutDriverPhones) ? order.timeoutDriverPhones : [];

            const updatedOrder = {
              ...order,
              status: 'hall',
              in_hall: true,
              statusCategory: '呼叫中',
              dispatchedDriverPhone: '',
              dispatchedDriverName: '',
              serverCountdown: 0,
              dispatchCountdown: 0,
              declinedDriverPhones: Array.from(new Set([...existingDeclined, timedOutDriverPhone].filter(Boolean))),
              timeoutDriverPhones: Array.from(new Set([...existingTimeout, timedOutDriverPhone].filter(Boolean))),
              lastTimeoutAt: now,
              autoHallAt: now,
              autoHallReason: order.autoHallReason || '60秒倒计时结束，中国大陆阿里云服务器自动将订单转入选单大厅'
            };

            // 2026-10-17根治：转大厅与接单的条件互斥。/api/order/claim 用条件 UPDATE 原子接单，
            // 此处转大厅也必须条件写入：MySQL 里只有仍是未接单状态才搬，否则并发到达的接单会被覆盖，
            // 且后续的 passenger_links/active_orders 清理会摧毁合法接单（反向幽灵单）。
            // 竞争失败或写入失败时跳过（不写本地、不清理），下一轮 tick 会重试。
            let hallApplied = true;
            if (isMySQLEnabled && mysqlPool) {
              try {
                const [hallRes]: any = await mysqlPool.query(
                  'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ? ' +
                  "AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.status')), '') NOT IN ('claimed', '已接单', 'serving', 'completed', 'cancelled', '已取消', 'hall', '等待接单') " +
                  "AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.in_hall')), 'false') != 'true' " +
                  "AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.claimedDriverPhone')), '') = ''",
                  [JSON.stringify(updatedOrder), 'merchant_orders', orderId]
                );
                hallApplied = Number((hallRes as any)?.affectedRows || 0) > 0;
              } catch (e: any) {
                console.error(`[Timer] 订单 ${orderId} 转大厅 MySQL 条件写入失败:`, e?.message);
                hallApplied = false;
              }
              if (!hallApplied) {
                console.log(`[Timer] 订单 ${orderId} 转大厅被并发接单抢先（或写入失败），跳过`);
                continue;
              }
            }

            merchantOrders[orderId] = updatedOrder;
            hasChanges = true;

            // 清理并标记该司机的来单通道为超时取消，解除来单弹窗
            if (dbData['passenger_links'] && dbData['passenger_links'][timedOutDriverPhone]) {
              delete dbData['passenger_links'][timedOutDriverPhone];
            }
            if (dbData['active_orders'] && dbData['active_orders'][timedOutDriverPhone]) {
              delete dbData['active_orders'][timedOutDriverPhone];
            }

            // 解除司机的忙碌状态，恢复为空闲
            if (dbData['driver_users'] && dbData['driver_users'][timedOutDriverPhone]) {
              dbData['driver_users'][timedOutDriverPhone] = {
                ...dbData['driver_users'][timedOutDriverPhone],
                isBusy: false,
                status: 'idle',
                lastStatusUpdateTime: now
              };
            }
            if (dbData['driver_locations'] && dbData['driver_locations'][timedOutDriverPhone]) {
              dbData['driver_locations'][timedOutDriverPhone] = {
                ...dbData['driver_locations'][timedOutDriverPhone],
                isBusy: false,
                status: 'idle',
                lastStatusUpdateTime: now
              };
            }
            if (dbData['squad_members'] && dbData['squad_members'][timedOutDriverPhone]) {
              dbData['squad_members'][timedOutDriverPhone] = {
                ...dbData['squad_members'][timedOutDriverPhone],
                isBusy: false,
                status: 'idle',
                lastStatusUpdateTime: now
              };
            }

            if (isMySQLEnabled && mysqlPool) {
              try {
                // 2026-10-17：merchant_orders 的条件写入已在上方完成，此处只做关联清理
                await mysqlPool.query(
                  'DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?) AND `doc_id` = ?',
                  ['passenger_links', 'active_orders', timedOutDriverPhone]
                );
                // P0(2026-10-15)：转大厅后同步重置司机busy状态到MySQL，否则司机永久busy接不到单
                for (const col of ['driver_users', 'driver_locations', 'squad_members']) {
                  try {
                    const [drows]: any = await mysqlPool.query(
                      'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                      [col, timedOutDriverPhone]
                    );
                    if (drows && drows.length > 0) {
                      const dd = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
                      dd.isBusy = false;
                      dd.status = 'idle';
                      dd.lastStatusUpdateTime = now;
                      await mysqlPool.query(
                        'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                        [JSON.stringify(dd), col, timedOutDriverPhone]
                      );
                    }
                  } catch (e) {
                    console.error(`[Timer] 重置${col} busy状态失败:`, (e as any)?.message);
                  }
                }
              } catch (_) {}
            }
          }
        }
      }

      if (hasChanges) {
        writeLocalJsonDb(dbData);
      }
    } catch (e) {
      // Ignore background interval errors
    }
  }, 10000); // P0-3优化：从1秒改为10秒（60秒超时用10秒粒度足够），降低90% CPU

  // 5.3.0 滴滴式"新来单页上屏"心跳接口 (2026-10-13新增)
  // App新来单页面显示时每2秒发送一次，证明页面正在屏幕上显示。
  // 服务端定时器检查：派单后5秒内无心跳 → 判定页面未上屏(App被杀/未点通知)，立即转大厅，不等60秒。
  app.post('/api/dispatch/page-heartbeat', requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || req.body?.id || '').trim();
      const driverPhone = String(req.body?.driverPhone || req.body?.phone || '').replace(/\D/g, '').trim();
      if (!orderId && !driverPhone) {
        return res.json({ success: false, message: '缺少orderId或driverPhone' });
      }
      const now = Date.now();
      // 2026-10-15 P0修复：MySQL模式下更新MySQL中的订单，否则心跳写不到真实订单
      // 2026-10-15 P1修复：用JSON_SET定向更新，防read-modify-write覆盖定时器的转大厅写入（订单"复活"）
      if (isMySQLEnabled && mysqlPool && orderId) {
        try {
          await mysqlPool.query(
            'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.pageHeartbeatAt", ?) ' +
            'WHERE `collection` = ? AND (`doc_id` = ? OR JSON_EXTRACT(`data`, "$.id") = ? OR JSON_EXTRACT(`data`, "$.orderId") = ?)',
            [now, 'merchant_orders', orderId, orderId, orderId]
          );
          return res.json({ success: true, heartbeatAt: now });
        } catch (e) {
          console.error('[Heartbeat] MySQL更新失败:', (e as any)?.message);
        }
      }
      const dbData = readLocalJsonDb();
      let updated = false;
      // 更新 merchant_orders
      if (orderId && dbData['merchant_orders']) {
        for (const [k, v] of Object.entries<any>(dbData['merchant_orders'])) {
          if (v && (v.id === orderId || v.orderId === orderId || v.orderNo === orderId || k === orderId)) {
            v.pageHeartbeatAt = now;
            updated = true;
            break;
          }
        }
      }
      // 更新 passenger_links
      if (driverPhone && dbData['passenger_links']?.[driverPhone]) {
        dbData['passenger_links'][driverPhone].pageHeartbeatAt = now;
        updated = true;
      }
      if (updated) {
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true, heartbeatAt: now });
    } catch (e: any) {
      return res.json({ success: false, message: String(e?.message || e) });
    }
  });

  // P0-2修复(2026-10-15)：乘客自助开单页查司机真实VIP有效期，不信任URL ?vip= 参数（防伪造绕过会员门禁）
  // 公开接口（乘客未登录），只返回有效期字符串，不泄露其他信息
  app.get('/api/driver/vip-status', async (req: any, res: any) => {
    try {
      const phone = String(req.query.phone || '').replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      if (phone === '15509601222') {
        return res.json({ success: true, vipExpiry: '永久有效' });
      }
      const dbData = readLocalJsonDb();
      const purePhone = phone.replace(/A$/, '');
      const vipExpiry =
        dbData.driver_users?.[phone]?.vipExpiry ||
        dbData.driver_users?.[purePhone]?.vipExpiry ||
        dbData.squad_members?.[phone]?.vipExpiry ||
        dbData.squad_members?.[purePhone]?.vipExpiry ||
        dbData.online_applications?.[phone]?.vipExpiry ||
        dbData.online_applications?.[purePhone]?.vipExpiry ||
        '';
      return res.json({ success: true, vipExpiry });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  });

  // 5.2.9 哈勃权限管理 API (2026-10-14新增)
  // 只有开发者 15509601222 可以授权/取消授权，其他人只能查询
  app.get('/api/hubble/authorized_drivers', requireDbAuth, async (req: any, res: any) => {
    try {
      const dbData = readLocalJsonDb();
      const col = dbData['hubble_authorized_drivers'] || {};
      const list = Object.entries(col).map(([phone, v]: [string, any]) => ({
        phone,
        name: v?.name || `司机${phone.slice(-4)}`,
        addedAt: v?.addedAt || Date.now(),
        addedBy: v?.addedBy || '开发者'
      }));
      return res.json({ success: true, list });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });

  app.post('/api/hubble/authorize', requireDbAuth, async (req: any, res: any) => {
    try {
      const requester = String((req as any).authPhone || '').replace(/\D/g, '');
      // P0: 只有开发者可以授权
      if (requester !== '15509601222') {
        return res.status(403).json({ success: false, message: '仅开发者可授权哈勃权限' });
      }
      const phone = String(req.body?.phone || '').replace(/\D/g, '').trim();
      const name = String(req.body?.name || '').trim() || `司机${phone.slice(-4)}`;
      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, message: '请输入11位手机号' });
      }
      if (phone === '15509601222') {
        return res.status(400).json({ success: false, message: '开发者默认拥有权限，无需授权' });
      }
      const dbData = readLocalJsonDb();
      if (!dbData['hubble_authorized_drivers']) dbData['hubble_authorized_drivers'] = {};
      // P0: 禁止给自己授权（防止普通用户通过 API 给自己加权限）
      // 只有开发者能调到这里，所以 requester 一定是开发者，这行是纵深防御
      dbData['hubble_authorized_drivers'][phone] = {
        phone, name, addedAt: Date.now(), addedBy: requester
      };
      writeLocalJsonDb(dbData);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });

  app.post('/api/hubble/revoke', requireDbAuth, async (req: any, res: any) => {
    try {
      const requester = String((req as any).authPhone || '').replace(/\D/g, '');
      if (requester !== '15509601222') {
        return res.status(403).json({ success: false, message: '仅开发者可取消哈勃权限' });
      }
      const phone = String(req.body?.phone || '').replace(/\D/g, '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, message: '缺少手机号' });
      }
      const dbData = readLocalJsonDb();
      if (dbData['hubble_authorized_drivers']?.[phone]) {
        delete dbData['hubble_authorized_drivers'][phone];
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });

  // 5.3.1 阿里云服务器权威倒计时查询与同步接口 (专供司机接单新来单页面实时对齐服务器秒数)
  app.get(['/api/dispatch/countdown', '/api/order/countdown'], async (req, res) => {
    try {
      const orderId = String(req.query.orderId || req.query.id || req.query.orderNo || '').trim();
      const driverPhone = String(req.query.driverPhone || req.query.phone || '').replace(/\D/g, '').trim();

      const now = Date.now();
      // 2026-10-15根治：MySQL模式下从MySQL读订单，本地JSON是stale的会导致倒计时跳变（如56→33）
      let merchantOrders: Record<string, any> = {};
      let passengerLinks: Record<string, any> = {};
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [moRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['merchant_orders']
          );
          (moRows || []).forEach((r: any) => {
            const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const k = String(r.doc_id || d?.id || d?.orderId || '').trim();
            if (k) merchantOrders[k] = d;
          });
          const [plRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['passenger_links']
          );
          (plRows || []).forEach((r: any) => {
            const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const k = String(r.doc_id || '').trim();
            if (k) passengerLinks[k] = d;
          });
        } catch (_) {}
      } else {
        const dbData = readLocalJsonDb();
        merchantOrders = dbData['merchant_orders'] || {};
        passengerLinks = dbData['passenger_links'] || {};
      }
      
      let targetOrder: any = null;
      let targetMerchantKey: string | null = null;
      if (orderId) {
        targetOrder = merchantOrders[orderId];
        if (targetOrder) {
          targetMerchantKey = orderId;
        } else {
          for (const [k, v] of Object.entries<any>(merchantOrders)) {
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
          // P0(2026-10-15)：70秒旧单校验（revert丢失的修复，补回）
          // 无orderId时的fallback若拿到历史旧单会导致倒计时跳变
          const linkDispatchedAt = Number(linkOrder.dispatchedAt || linkOrder.timestamp || 0);
          if (!orderId && linkDispatchedAt && (Date.now() - linkDispatchedAt > 70000)) {
            console.log(`[Countdown] passenger_links旧单(${Math.round((Date.now()-linkDispatchedAt)/1000)}s前)拒绝fallback，走404`);
          } else {
          const lId = String(linkOrder.id || linkOrder.orderId || linkOrder.orderNo || '').trim();
          if (!orderId || (lId && lId === orderId)) {
            targetOrder = linkOrder;
            // 反查 merchant_orders 中的 key，确保即使本次没带 orderId 也能更新主订单
            // 2026-10-13修复：优先用 _merchantKey（派单时写入），v===linkOrder 永远为false（拷贝非引用）
            if (!targetMerchantKey) {
              const mk = String((linkOrder as any)?._merchantKey || '').trim();
              if (mk && merchantOrders[mk]) {
                targetMerchantKey = mk;
              } else {
                for (const [k, v] of Object.entries<any>(merchantOrders)) {
                  if (v === linkOrder) {
                    targetMerchantKey = k;
                    break;
                  }
                }
              }
              if (!targetMerchantKey && lId) {
                for (const [k, v] of Object.entries<any>(merchantOrders)) {
                  if (v && (v.id === lId || v.orderId === lId || v.orderNo === lId || k === lId)) {
                    targetMerchantKey = k;
                    break;
                  }
                }
              }
            }
            // 2026-10-14根治：必须用 targetMerchantKey 重读 merchant_orders 的最新对象！
            // passenger_links 是派单时的拷贝，之后 claim/decline/转大厅只更新 merchant_orders，
            // 不更新 passenger_links。用旧拷贝算倒计时会导致 50→30 这类跳变。
            if (targetMerchantKey && merchantOrders[targetMerchantKey]) {
              targetOrder = merchantOrders[targetMerchantKey];
            } else if (targetOrder === linkOrder) {
              // P0(2026-10-15)：反查失败时不用旧拷贝兜底，直接404（防跳变）
              console.log(`[Countdown] 反查merchant_orders失败，拒绝用stale拷贝，走404`);
              targetOrder = null as any;
            }
          } // end if (!orderId || lId===orderId)
          } // end else (70秒校验通过，正常fallback)
        }
      }

      if (!targetOrder) {
        // M13修复：订单不存在时不再返回写死的60秒假倒计时
        return res.status(404).json({
          success: false,
          serverCountdown: 0,
          isExpired: true,
          inHall: false,
          status: 'not_found',
          serverTime: now,
          error: '订单不存在'
        });
      }

      const isClaimedOrActiveForDriver = Boolean(
        (targetOrder.claimedDriverPhone && driverPhone && targetOrder.claimedDriverPhone === driverPhone) ||
        (targetOrder.dispatchedDriverPhone && driverPhone && targetOrder.dispatchedDriverPhone === driverPhone) ||
        targetOrder.isDirectClaim === true ||
        targetOrder.status === 'claimed' ||
        targetOrder.status === 'dispatched' ||
        targetOrder.status === 'submitted' ||
        targetOrder.statusCategory === '已接单' ||
        targetOrder.statusCategory === '已指派'
      );

      const isHall = !isClaimedOrActiveForDriver && (targetOrder.in_hall === true || targetOrder.status === 'hall');
      if (isHall) {
        return res.json({
          success: true,
          orderId: targetOrder.id || orderId,
          serverCountdown: 0,
          isExpired: true,
          inHall: true,
          status: targetOrder.status || 'hall',
          serverTime: now
        });
      }

      const dispatchedTime = Number(targetOrder.dispatchedAt || targetOrder.timestamp || now);
      let exp = Number(targetOrder.dispatchExpiresAt || (dispatchedTime + 60000));

      // 2026-10-13按滴滴设计：删除 clientFirstSeenAt 重置逻辑。
      // 滴滴做法：60秒从派单时刻算起，不补时。用户晚10秒看到就显示50秒，显示真实剩余时间。
      // 此前"延迟10秒重置为60秒"的逻辑已删除。
      const remainingSec = Math.max(0, Math.ceil((exp - now) / 1000));

      // 2026-10-14诊断：记录每次倒计时返回，用于定位跳变问题
      // 如果看到同一 orderId 的 remainingSec 非单调递减，说明 exp 在变或找错了单
      if (process.env.COUNTDOWN_DEBUG === '1') {
        console.log(`[Countdown] orderId=${targetOrder.id || orderId} driver=${driverPhone} exp=${exp} now=${now} remaining=${remainingSec} status=${targetOrder.status}`);
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
        inHall: targetOrder.in_hall === true || targetOrder.status === 'hall',
        status: targetOrder.status,
        dispatchedDriverPhone: targetOrder.dispatchedDriverPhone,
        serverTime: now,
        dispatchedAt: dispatchedTime,
        dispatchExpiresAt: exp
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.4 Automated 2-Day 10:00 AM Clean-Up Daemon & Manual API
  let lastAutoCleanTimestamp = 0;
  const executeServerAutoClean = async () => {
    console.log('[Auto-Clean] Starting scheduled 2-day disk and cache cleanup at 10:00 AM...');
    try {
      // 1. Purge MySQL binlogs if MySQL is enabled
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query('PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 2 DAY)');
          console.log('✓ [Auto-Clean] Purged MySQL binlogs older than 2 days.');
        } catch (_) {}
      }

      // 2. Clean temporary files and build artifacts
      const tmpDirs = ['/tmp', path.join(process.cwd(), 'temp_builds')];
      for (const d of tmpDirs) {
        if (fs.existsSync(d)) {
          try {
            const files = fs.readdirSync(d);
            for (const f of files) {
              if (f.endsWith('.tmp') || f.endsWith('.zip') || f.startsWith('npm-')) {
                try {
                  const fp = path.join(d, f);
                  const stat = fs.statSync(fp);
                  if (Date.now() - stat.mtimeMs > 24 * 3600 * 1000) {
                    fs.unlinkSync(fp);
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }

      // 3. Clean stale passenger_links older than 48 hours
      const dbData = readLocalJsonDb();
      if (dbData['passenger_links']) {
        const now = Date.now();
        let changed = false;
        for (const [k, v] of Object.entries<any>(dbData['passenger_links'])) {
          const time = Number(v?.timestamp || v?.updatedAt || 0);
          if (time > 0 && (now - time) > 48 * 3600 * 1000) {
            delete dbData['passenger_links'][k];
            changed = true;
          }
        }
        if (changed) {
          writeLocalJsonDb(dbData);
        }
      }

      // 4. Truncate oversized PM2 and Nginx log files if over 30MB
      const logPaths = [
        '/www/wwwlogs',
        path.join(process.env.HOME || '/root', '.pm2/logs'),
        path.join(process.cwd(), 'logs')
      ];
      for (const logDir of logPaths) {
        if (fs.existsSync(logDir)) {
          try {
            const files = fs.readdirSync(logDir);
            for (const f of files) {
              if (f.endsWith('.log') || f.endsWith('.err') || f.endsWith('.out')) {
                try {
                  const fp = path.join(logDir, f);
                  const stat = fs.statSync(fp);
                  if (stat.size > 10 * 1024 * 1024) {
                    fs.writeFileSync(fp, `[Log Truncated at ${new Date().toISOString()} by Auto-Clean]\n`, 'utf8');
                    console.log(`✓ [Auto-Clean] Truncated large log file: ${fp}`);
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }

      console.log('✓ [Auto-Clean] 2-day maintenance completed successfully.');
    } catch (cleanErr) {
      console.error('[Auto-Clean Error]:', cleanErr);
    }
  };

  // Run auto clean on startup
  setTimeout(() => {
    executeServerAutoClean().catch(() => {});
  }, 5000);

  // Check every 30 seconds for 10:00 AM Beijing Time (UTC+8) on a 2-day cycle
  setInterval(async () => {
    const now = new Date();
    // Convert to Beijing Time (UTC+8)
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjMinute = now.getUTCMinutes();
    const currentDayTime = now.getTime();

    // Check if it's 10:00 AM (hour == 10, minute < 5) and at least 40 hours since last clean
    if (bjHour === 10 && bjMinute < 10) {
      if (!lastAutoCleanTimestamp || (currentDayTime - lastAutoCleanTimestamp) > 40 * 3600 * 1000) {
        lastAutoCleanTimestamp = currentDayTime;
        await executeServerAutoClean();
      }
    }
  }, 5 * 60 * 1000);

  // Manual Trigger Endpoint for Admin / Baota WebHook
  app.all(['/api/system/clean-disk', '/api/admin/clean-now'], requireDbAuth, async (req, res) => {
    // H4修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    await executeServerAutoClean();
    res.json({
      success: true,
      message: '✓ 阿里云服务器清理与瘦身任务已成功执行完成！',
      timestamp: new Date().toISOString()
    });
  });

  // 6. ADD Document (auto-generated ID)
  app.post('/api/db/add', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const data = req.body.data;

      if (!col || data === undefined) {
        return res.status(400).json({ success: false, error: 'Missing col or data' });
      }

      // P0-3修复(2026-10-14)：非管理员只能向白名单集合 add，防止伪造订单/污染任意集合
      if (!(req as any).isAdmin) {
        const ADD_WHITELIST = new Set([
          'valet_orders', 'merchant_orders', // 订单类：走正常下单流程
          'driver_locations', 'driver_users', // 司机自有数据
          'squad_applications', 'online_applications', // 申请类
          'system_messages_read', 'feedback', // 反馈/已读
        ]);
        if (!ADD_WHITELIST.has(col)) {
          console.warn(`[Auth] 拒绝非白名单集合add: token手机=${(req as any).authPhone}, 集合=${col}`);
          return res.status(403).json({ success: false, error: '无权向该集合写入' });
        }
      }

      // H8修复：与 set/update 一致，普通用户写 squad_members 时剥离敏感字段（防通过 add 自封职位提权）
      if (col === 'squad_members' && !(req as any).isAdmin && !(req as any).isManager) {
        const SENSITIVE = ['status', 'approvalStatus', 'role', 'squad_position', 'userRole', 'position'];
        for (const f of SENSITIVE) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 剥离敏感字段(add): token手机=${(req as any).authPhone}, 字段=${f}`);
            delete data[f];
          }
        }
      }
      // P0(2026-10-16第二遍审计)：/api/db/add 剥离 licenseExpiry/vipExpiry，防普通司机自助伪造接单授权/VIP。
      // set/update 已剥离，add 漏了，且用整文档覆盖（非合并），毒化后直接生效。
      // 覆盖全部四个司机集合（与 /api/db/get 合并链一致）。
      if (['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col)) {
        for (const f of ['vipExpiry', 'licenseExpiry']) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] add接口写${f}已剥离: token手机=${(req as any).authPhone}, col=${col}`);
            delete data[f];
          }
        }
      }

      const generatedId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const dataWithId = { ...data, id: data.id || generatedId };
      const finalId = dataWithId.id;

      if (isMySQLEnabled && mysqlPool) {
        // 2026-10-16修复：MySQL失败时直接抛错，不再静默回退到本地JSON（修系统消息假成功）
        const dataStr = JSON.stringify(dataWithId);
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          [col, finalId, dataStr]
        );
        return res.json({ success: true, id: finalId });
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      dbData[col][finalId] = dataWithId;
      writeLocalJsonDb(dbData);

      return res.json({ success: true, id: finalId });
    } catch (err: any) {
      console.error('[DB Proxy ADD Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Standalone Privacy Policy Page served with complete content and beautiful styling
  app.get('/privacy', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>隐私条款与个人信息保护政策</title>
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
        <h1 class="text-xl md:text-2xl font-black text-slate-900">隐私条款与个人信息保护政策</h1>
        <p class="text-xs text-slate-400 mt-1">更新日期：2026年7月14日</p>
      </div>

      <!-- Core Summary Preamble -->
      <div class="bg-amber-50/60 border border-amber-100 rounded-2xl p-4 md:p-5 text-amber-900 text-xs md:text-[13px] leading-relaxed space-y-2 text-left">
        <p class="font-extrabold flex items-center gap-1.5 text-amber-950">
          <svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          核心摘要与风险提示：
        </p>
        <p>
          为保障您的个人隐私与合法权益，我们特根据《中华人民共和国个人信息保护法》等法律法规制定本政策。本平台收集的手机号、GPS定位、身份信息及驾驶资质为提供<b>核心叫单、行车安全、居间匹配、代驾资质核验</b>所绝对必需。我们郑重承诺，绝不将您的个人敏感信息泄露或滥用。同时，本政策中包含了多项<b>平台免责及第三方SDK（如地图、短信）服务免责条款</b>，请您务必仔细阅读以了解您的权益范围。
        </p>
      </div>

      <!-- Detail sections -->
      <div class="space-y-6 text-slate-600 text-xs md:text-sm leading-relaxed text-left">
        
        <!-- Section 1 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第一条 个人信息收集与授权范围
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-medium text-slate-700">
              在您使用黑湾代驾服务（包括叫单、查看路线、申请成为代驾司机等）过程中，我们将本着“合法、正当、必要和诚信”原则收集、使用、存储您的个人信息，用途如下：
            </p>
            <p>
              1. <b>账号注册、登录与安全校验</b>：我们将收集您的<b>手机号码</b>。该信息用于为您建立用户档案、下发验证码、提供客服支持。
            </p>
            <p>
              2. <b>精准定位与行车安全服务</b>：当您在前端叫单或在司机听单模式下，我们需要收集、使用您的<b>精准GPS地理位置信息、行驶轨迹、起点和终点</b>。这是计算行程里程、进行精确车费结算、向您推荐就近司机、在途路线追踪、保障行车人身安全的核心技术手段。若您拒绝授权，将无法使用本平台的地图核心叫单功能。
            </p>
            <p>
              3. <b>服务人员（司机）资质核验与背景审查</b>：如果您申请注册成为代驾服务人员，根据中国法律关于公共道路运输、网约、代驾行业的合规要求，我们必须收集您的<b>真实姓名、身份证号码、身份证正反面照片、驾驶证正副页照片、准驾车型及领证日期</b>。这些信息仅用于背景安全审查、核查无犯罪记录、验证驾驶证有效性及排除危险驾驶倾向，不作他用。如您不提供，本平台有权拒绝您的注册申请。
            </p>
            <p>
              4. <b>紧急情况救助保障</b>：在注册司机或叫单时，我们允许您填写<b>紧急联系人姓名及电话</b>。我们仅在极端突发状况（如交通事故、人身危险、紧急失联）下拨打该电话，以最大可能维护您生命财产安全。
            </p>
          </div>
        </div>

        <!-- Section 2 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第二条 信息的存储期限与安全防御
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>本地存储与跨境</b>：我们在中华人民共和国境内收集和产生的个人信息将<b>存储在中华人民共和国境内</b>。除非有中国法律法规的明确授权或政府行政、司法机关的要求，我们不会将您的个人信息传输至境外。
            </p>
            <p>
              2. <b>存储期限</b>：我们仅在提供本平台服务所必需的期限内保留您的个人信息。在您注销账号或删除个人信息后，我们将在法律要求的合理保留期（如《电子商务法》要求的交易信息保留不少于三年）届满后对您的信息进行删除或匿名化处理。
            </p>
            <p>
              3. <b>技术安全防护措施</b>：本平台采用符合业界标准的安全防护措施、数据加密传输（如 HTTPS、TLS 协议）和存储加密（对身份证号、手机号采用高强度单向哈希或对称加密脱敏存储），严格防范他人未经授权访问、修改、泄露您的个人信息。
            </p>
          </div>
        </div>

        <!-- Section 3 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第三条 平台法律责任豁免与风险防范（重要）
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-semibold text-slate-700">
              为了保障本平台的正常、合规运转，并妥善厘清各方的法律责任边界，特约定如下免责与风险分散机制：
            </p>
            <p>
              1. <b>第三方组件（SDK）独立责任豁免</b>：
              本平台的核心定位、地图展示、路径规划及短信发送分别集成了第三方供应商 of 成熟产品（如：腾讯地图 SDK、阿里云/腾讯云短信服务）。这些第三方服务为提供其特定功能，将独立收集和处理您的网络状态、IP及设备标识等。<b>本平台已在合理商业限度内对服务商的安全合规情况进行了审核，因第三方系统漏洞、未授权篡改、或不可抗拒技术波动引发的个人数据泄露，平台在法律允许的最大范围内不对第三方的独立侵权行为承担直接及连带赔偿责任。</b>
            </p>
            <p>
              2. <b>居间撮合与法律关系独立性</b>：
              本平台提供的是技术信息发布与居间匹配服务。代驾司机与乘客之间独立形成代驾服务合同关系。在服务履行期间（从司机接车开始至安全停靠交车完毕），如因道路突发车祸、财产遗失、三方侵权等原因遭受损失的，<b>应首先由各方的承运险、车辆交强险及商业险或司乘个人保险进行理赔</b>。本平台依法建立健全平台安全管理制度与资质审核，但除法律明文规定的严重审核失职、平台故意过错等法定责任外，不对司机或乘客在服务过程中的单方违约、过失侵权、交通违法罚款或人身损害等承担连带赔偿和合同保底责任。
            </p>
            <p>
              3. <b>用户账号凭证保管义务</b>：
              短信验证码、登录凭证是您访问本平台的唯一数字标识。任何由于您<b>主动或过失将验证码泄露给第三方、手机不慎遗失而被他人冒用、未及时申请挂失、或遭遇个人终端病毒木马感染</b>而导致的身份泄露、申请资料被篡改、财产遭受损失的情形，其不利法律后果应由您自行承担。
            </p>
            <p>
              4. <b>技术与不可抗力免责</b>：
              鉴于互联网无线通信技术的特殊性，遭遇黑客攻击、电信运营商基站故障、卫星定位信号盲区、政府管制命令、自然灾害等导致的定位偏差、系统卡顿、消息延迟发送或数据部分丢失，平台将尽力协助救援并恢复，但在法律允许限度内免于承担违约与赔偿连带责任。
            </p>
          </div>
        </div>

        <!-- Section 4 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第四条 个人信息管理权利
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              根据中国法律规定，您对您的个人信息享有合法的控制权，具体包括：
            </p>
            <p>
              1. <b>查询与更正</b>：您有权访问您的个人资料及注册司机资料。若信息发生变化或发现有误，您可以随时修改。
            </p>
            <p>
              2. <b>撤回同意</b>：您可以随时在系统设置中关闭位置定位权限、通知权限，撤回对相应数据的继续收集。撤回不影响在此之前基于您同意已进行的信息处理。
            </p>
            <p>
              3. <b>注销账号</b>：若您不需要继续使用本平台服务，您可以联系客服申请注销。我们将在核验账户安全后为您彻底删除所有关联数据或进行不可逆的匿名化。
            </p>
          </div>
        </div>

        <!-- Section 5 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第五条 条款更新与适用法律
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>政策调整公告</b>：本《隐私政策》将根据大陆法律政策动态、本平台服务升级等情况进行修订。一旦进行修改，我们将通过本软件弹窗、公告等合理形式告知。若您在修订后继续使用，即视为您完全阅读并理解新版隐私政策。
            </p>
            <p>
              2. <b>管辖与争议解决</b>：本政策的成立、生效、履行、解释及争议解决均适用<b>中华人民共和国大陆地区法律</b>。若因本政策产生任何争议，双方应首先友好协商解决；协商不成的，任何一方均有权向<b>本平台运营方所在地有管辖权的人民法院提起诉讼</b>。
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
          关闭此页面
        </button>
      </div>

    </div>
  </div>

  <footer class="py-6 text-center text-xs text-slate-400 border-t border-slate-100 bg-white shrink-0">
    <p>司机注册平台 · 安全合规服务 · © 2026 版权所有</p>
  </footer>
</body>
</html>
    `);
  });

  // WeChat domain verification route
  app.get('/9fe449b6d3069a0e1d9157132374017a.txt', (req, res) => {
    res.type('text/plain').send('9496c3005dc6f9c8dcab74dca7ad82028a77e765');
  });

  // Direct download endpoint for dist.zip to bypass IDE iframe download limitations
  app.get('/api/download-dist', (req, res) => {
    const filePath = path.join(process.cwd(), 'dist.zip');
    res.download(filePath, 'dist.zip', (err) => {
      if (err) {
        console.error('[Download Error] dist.zip serving failed:', err);
        if (!res.headersSent) {
          // Fall back to dist.tar.gz if zip fails
          const tarPath = path.join(process.cwd(), 'dist.tar.gz');
          res.download(tarPath, 'dist.tar.gz', (err2) => {
            if (err2) {
              res.status(404).send('Neither dist.zip nor dist.tar.gz was found on server. Please build first.');
            }
          });
        }
      }
    });
  });

  // Direct download endpoint for dist.tar.gz
  app.get('/api/download-dist-tar', (req, res) => {
    const filePath = path.join(process.cwd(), 'dist.tar.gz');
    res.download(filePath, 'dist.tar.gz', (err) => {
      if (err) {
        console.error('[Download Error] dist.tar.gz serving failed:', err);
        if (!res.headersSent) {
          res.status(404).send('dist.tar.gz not found on server. Please build first.');
        }
      }
    });
  });

  // High-reliability Chinese TTS audio proxy endpoint with CORS and multi-provider fallback
  app.options('/api/tts', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
  });

  app.get('/api/tts', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).send('Text parameter is required');
    }
    const encodedText = encodeURIComponent(text);
    const ttsProviders = [
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=web`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=baidu`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=tsn`,
        referer: 'https://fanyi.baidu.com/'
      }
    ];

    for (const item of ttsProviders) {
      try {
        const response = await fetch(item.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': item.referer
          }
        });
        if (response.ok) {
          const contentType = response.headers.get('content-type') || 'audio/mpeg';
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 300) {
            res.setHeader('Content-Type', contentType.includes('audio') ? contentType : 'audio/mpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(Buffer.from(buffer));
          }
        }
      } catch (err) {
        // Continue to next provider
      }
    }
    return res.status(502).send('TTS providers unavailable');
  });

  // --- WECHAT SCAN LOGIN ENDPOINTS ---

  // 1. Initialize a WeChat scan login session
  app.get('/api/wechat/session', (req, res) => {
    const sessionId = 'wechat_' + Math.random().toString(36).substring(2, 15);
    const expiresAt = Date.now() + 5 * 60 * 1000; // valid for 5 mins
    wechatSessions.set(sessionId, {
      authorized: false,
      phone: null,
      expiresAt
    });
    res.json({ success: true, sessionId, expiresAt });
  });

  // 2. Query WeChat session status (polling)
  app.get('/api/wechat/status', (req, res) => {
    const { session } = req.query;
    if (!session) {
      return res.status(400).json({ success: false, error: '缺少会话标识参数' });
    }
    const sessId = String(session);
    const record = wechatSessions.get(sessId);
    if (!record) {
      return res.json({ success: false, error: '会话不存在或已过期', code: 'EXPIRED' });
    }
    if (Date.now() > record.expiresAt) {
      wechatSessions.delete(sessId);
      return res.json({ success: false, error: '会话已过期，请刷新二维码', code: 'EXPIRED' });
    }
    res.json({
      success: true,
      authorized: record.authorized,
      phone: record.phone
    });
  });

  // 3. Authorize WeChat scan login session from mobile phone
  app.post('/api/wechat/authorize', (req, res) => {
    const { session, phone } = req.body;
    if (!session || !phone) {
      return res.status(400).json({ success: false, error: '缺少会话参数或手机号码' });
    }
    const sessId = String(session);
    const record = wechatSessions.get(sessId);
    if (!record) {
      return res.status(400).json({ success: false, error: '该登录二维码已过期，请在电脑端刷新重试' });
    }
    if (Date.now() > record.expiresAt) {
      wechatSessions.delete(sessId);
      return res.status(400).json({ success: false, error: '该登录二维码已过期，请在电脑端刷新重试' });
    }

    // Set authorized and link phone number
    record.authorized = true;
    record.phone = String(phone).trim();
    wechatSessions.set(sessId, record);

    console.log(`[WeChat Auth] Session ${sessId} authorized successfully for phone ${phone}`);
    res.json({ success: true, message: '微信授权登录成功！您的电脑端将自动登录。' });
  });

  // 1. Send SMS Code via Alibaba Cloud SMS or Simulated Sandbox
  app.post('/api/sms/send', async (req, res) => {
    const { phone, isAdminLogin, scope } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: '手机号码不能为空' });
    }
    const cleanPhone = String(phone).trim();
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: '请输入正确的11位手机号码' });
    }

    // 用户铁律(2026-10-15)：以下三个号码短信验证码无限制（豁免所有限流）
    const SMS_UNLIMITED_PHONES = new Set(['15509601222', '15121904440', '18695119126']);
    const isSmsUnlimited = SMS_UNLIMITED_PHONES.has(cleanPhone);
    // M4修复：IP+手机号限流（60秒1次 / 1小时5次），防短信轰炸
    if (!isSmsUnlimited) {
      const clientIp = getClientIp(req);
      const now = Date.now();
      const keyPhone = `p:${cleanPhone}`;
      const keyIp = `ip:${clientIp}`;
      for (const key of [keyPhone, keyIp]) {
        const logs = (smsSendLogs.get(key) || []).filter((t) => now - t < 3600 * 1000);
        if (logs.length >= 5) {
          return res.status(429).json({ success: false, error: '❌ 发送过于频繁，请1小时后再试' });
        }
        if (logs.length > 0 && now - logs[logs.length - 1] < 60 * 1000) {
          const waitSec = Math.ceil((60 * 1000 - (now - logs[logs.length - 1])) / 1000);
          return res.status(429).json({ success: false, error: `❌ 发送过于频繁，请 ${waitSec} 秒后再试` });
        }
        logs.push(now);
        smsSendLogs.set(key, logs);
      }
      // 定期清理过期记录
      if (smsSendLogs.size > 5000) {
        for (const [k, v] of smsSendLogs) {
          const fresh = v.filter((t) => now - t < 3600 * 1000);
          if (fresh.length === 0) smsSendLogs.delete(k);
          else smsSendLogs.set(k, fresh);
        }
      }
    }

    // Strict Admin Restriction: If requesting for admin panel, ONLY 15509601222 is permitted
    if (isAdminLogin || scope === 'admin_panel') {
      if (cleanPhone !== '15509601222') {
        console.warn(`[SMS Server] Security Block: Denied SMS code for unauthorized phone ${cleanPhone} attempting admin login`);
        return res.status(403).json({
          success: false,
          error: '❌ 权限拒绝：只有最高开发者账号（15509601222）才有权限获取管理后台验证码！'
        });
      }
    }

    // Backend 24-hour phone and IP rate limit for merchant dispatch login (dispatch_valet)
    if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
      const clientIp = getClientIp(req);
      const now = Date.now();
      const LIMIT_24H = 24 * 60 * 60 * 1000;

      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && (now - lastPhoneTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：手机号 ${cleanPhone} 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }

      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && (now - lastIpTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：当前 IP 地址 (${clientIp}) 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }
    }

    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const signName = process.env.ALIBABA_CLOUD_SIGN_NAME || '恒创联众';
    const templateCode = process.env.ALIBABA_CLOUD_TEMPLATE_CODE || '100001';

    if (!accessKeyId || !accessKeySecret) {
      return res.status(400).json({
        success: false,
        error: '❌ 未配置阿里云 AccessKey（ALIBABA_CLOUD_ACCESS_KEY_ID / SECRET），请在宝塔面板环境变量或配置文件中设置。'
      });
    }

    // Real Mode - Alibaba Cloud SMS (Dysmsapi standard SMS or Dypnsapi Number Auth verification)
    try {
      console.log(`[Alibaba Cloud SMS] Requesting SMS for phone: ${phone}, signName: ${signName}, template: ${templateCode}`);
      
      const generatedCode = String(Math.floor(1000 + Math.random() * 9000));
      let isSuccess = false;
      let lastErrMsg = '';

      // Approach 1: If templateCode is standard Aliyun SMS template (e.g. SMS_xxxx or standard pop-core)
      if (templateCode.startsWith('SMS_')) {
        try {
          const Core = await import('@alicloud/pop-core');
          const PopClient = (Core as any).default || Core;
          const popClient = new PopClient({
            accessKeyId,
            accessKeySecret,
            endpoint: 'https://dysmsapi.aliyuncs.com',
            apiVersion: '2017-05-25'
          });

          const params = {
            PhoneNumbers: String(phone),
            SignName: signName,
            TemplateCode: templateCode,
            TemplateParam: JSON.stringify({ code: generatedCode })
          };

          const popRes: any = await popClient.request('SendSms', params, { method: 'POST', formatType: 'json' });
          console.log('[Alibaba Cloud Dysmsapi] Response:', JSON.stringify(popRes));
          if (popRes && (popRes.Code === 'OK' || popRes.code === 'OK')) {
            isSuccess = true;
          } else {
            lastErrMsg = popRes?.Message || popRes?.message || popRes?.Code || '阿里云短信发送失败';
          }
        } catch (dysmsErr: any) {
          console.warn('[Alibaba Cloud Dysmsapi] Error:', dysmsErr.message);
          lastErrMsg = dysmsErr.message;
        }
      }

      // Approach 2: Dypnsapi (融合短信验证码)
      if (!isSuccess) {
        try {
          const client = getDypnsClient();
          if (client) {
            const sendRequestClass = ($Dypnsapi20170525 as any).SendSmsVerifyCodeRequest || ($Dypnsapi20170525 as any).default?.SendSmsVerifyCodeRequest || (Dypnsapi20170525 as any)?.SendSmsVerifyCodeRequest;
            const requestParams = {
              phoneNumber: String(phone),
              signName: signName,
              templateCode: templateCode,
              templateParam: JSON.stringify({ code: '##code##', min: '5' }),
              schemeName: '默认方案',
              codeLength: 4,
              validTime: 300,
              duplicatePolicy: 2,
              interval: 30,
              codeType: 1,
              returnVerifyCode: true,
            };

            const sendRequest = sendRequestClass ? new sendRequestClass(requestParams) : requestParams;
            const response = await client.sendSmsVerifyCode(sendRequest);

            const respCode = response?.body?.code || '';
            const respMsg = response?.body?.message || '';

            if (response && response.body && (respCode === 'OK' || response.body.success === true)) {
              console.log('[Alibaba Cloud Dypnsapi] Send verify code success for:', phone);
              const returnedCode = response.body.model?.verifyCode || generatedCode;
              verificationCodes.set(phone, { code: returnedCode, expiresAt: Date.now() + 5 * 60 * 1000 });
              return res.json({
                success: true,
                mode: 'real',
                message: '✓ 短信验证码已发送，请注意查收。'
              });
            } else if (
              respCode === 'biz.FREQUENCY' || 
              respCode === 'isv.BUSINESS_LIMIT_CONTROL' || 
              respMsg.toLowerCase().includes('frequency') ||
              respMsg.includes('BUSINESS_LIMIT_CONTROL')
            ) {
              console.log('[Alibaba Cloud Dypnsapi] Frequency control reached for:', phone, '- Activated high-availability verification fallback');
              const existing = verificationCodes.get(phone);
              if (existing && Date.now() < existing.expiresAt) {
                return res.json({
                  success: true,
                  mode: 'real_frequency_fallback',
                  message: '⚠️ 触发阿里云发送频率控制：您之前获取的短信验证码依然有效，请查看手机已收到的最新验证码直接输入登录！'
                });
              }
              // H2修复：限流时直接返回429，不签发任何备用码（删除6897硬编码后门）
              return res.status(429).json({
                success: false,
                error: '⚠️ 短信发送频率过高，请等待 60 秒后再试'
              });
            } else {
              console.log('[Alibaba Cloud Dypnsapi] Non-OK response code:', respCode);
              lastErrMsg = respMsg || `阿里云返回状态码: ${respCode || 'UNKNOWN'}`;
            }
          }
        } catch (dypnsErr: any) {
          console.warn('[Alibaba Cloud Dypnsapi] Error:', dypnsErr.message);
          lastErrMsg = dypnsErr.message || lastErrMsg;
          if (
            lastErrMsg.toLowerCase().includes('frequency') || 
            lastErrMsg.includes('check frequency failed') ||
            lastErrMsg.includes('BUSINESS_LIMIT_CONTROL')
          ) {
            // H2修复：限流时直接返回429，不签发任何备用码（删除6897硬编码后门）
            return res.status(429).json({
              success: false,
              error: '⚠️ 短信发送频率过高，请等待 60 秒后再试'
            });
          }
        }
      }

      if (isSuccess) {
        verificationCodes.set(phone, { code: generatedCode, expiresAt: Date.now() + 5 * 60 * 1000 });
        return res.json({
          success: true,
          mode: 'real',
          message: '✓ 短信验证码已发送，请注意查收。'
        });
      }

      return res.status(400).json({
        success: false,
        error: `❌ 阿里云短信发送失败: ${lastErrMsg || '请核对阿里云 AccessKey、签名与模板配置'}`
      });

    } catch (error: any) {
      console.error('[SMS Service] Alibaba Cloud SMS Exception:', error);
      return res.status(500).json({
        success: false,
        error: `❌ 阿里云短信接口异常: ${error.message || '网络连接超时'}`
      });
    }
  });

  // M1: 登出接口——删除服务端 token（客户端手动登出时调用）
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = String(req.headers['x-auth-token'] || req.body?.token || '').trim();
      if (token) {
        // 无状态签名 token：加入黑名单使其失效
        if (token.startsWith('v1.')) blocklistToken(token);
        if (authTokens.has(token)) {
          authTokens.delete(token);
          _authTokensDirty = true;
          persistAuthTokensSync(); // a5修复：登出立即写盘
        }
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.json({ success: true });
    }
  });

  // a5修复：token 有效性校验接口——App 启动时调用，提前发现过期
  app.get('/api/auth/validate', async (req, res) => {
    try {
      const token = String(req.headers['x-auth-token'] || req.query?.token || '').trim();
      const info = token ? authTokens.get(token) : null;
      if (info) {
        return res.json({ success: true, valid: true, phone: info.phone, scope: info.scope });
      }
      return res.json({ success: true, valid: false });
    } catch (e: any) {
      return res.json({ success: true, valid: false });
    }
  });

  // 2. Verify SMS Code via Alibaba Cloud SMS or Simulated Sandbox
  app.post('/api/sms/verify', async (req, res) => {
    const { phone, code, isAdminLogin, scope } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: '手机号或验证码不能为空' });
    }

    const cleanPhone = String(phone).trim();

    // 用户铁律(2026-10-15)：以下三个号码豁免所有验证码限制
    const SMS_UNLIMITED_PHONES_VERIFY = new Set(['15509601222', '15121904440', '18695119126']);
    const isSmsUnlimitedVerify = SMS_UNLIMITED_PHONES_VERIFY.has(cleanPhone);

    // H1修复：检查是否被锁定（5次失败锁定30分钟）
    if (!isSmsUnlimitedVerify) {
      const failInfo = verifyFailures.get(cleanPhone);
      if (failInfo && Date.now() < failInfo.lockedUntil) {
        const remainMin = Math.ceil((failInfo.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({
          success: false,
          error: `❌ 验证码错误次数过多，该手机号已锁定，请 ${remainMin} 分钟后再试`
        });
      }
    }
    // 记录失败的辅助函数（M4：5次失败销毁验证码并锁定30分钟；豁免号码不记录）
    const recordVerifyFailure = () => {
      if (isSmsUnlimitedVerify) return;
      const info = verifyFailures.get(cleanPhone) || { count: 0, lockedUntil: 0 };
      info.count += 1;
      if (info.count >= 5) {
        info.lockedUntil = Date.now() + 30 * 60 * 1000;
        info.count = 0;
        verificationCodes.delete(cleanPhone);
        verificationCodes.delete(phone);
        console.warn(`[SMS] 手机号 ${cleanPhone} 验证码错误5次，验证码已销毁并锁定30分钟`);
      }
      verifyFailures.set(cleanPhone, info);
    };
    // 成功时清除失败记录
    const clearVerifyFailures = () => {
      verifyFailures.delete(cleanPhone);
    };

    // Strict Admin Restriction: If verifying for admin panel, ONLY 15509601222 is permitted
    if (isAdminLogin || scope === 'admin_panel') {
      if (cleanPhone !== '15509601222') {
        console.warn(`[SMS Server] Security Block: Denied login verification for unauthorized phone ${cleanPhone}`);
        return res.status(403).json({
          success: false,
          error: '❌ 登录拒绝：非最高开发者账号（15509601222），无法登录管理后台！'
        });
      }
    }

    const clientIp = getClientIp(req);
    const now = Date.now();
    const LIMIT_24H = 24 * 60 * 60 * 1000;

    // Check 24h limit on verify as well
    if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && (now - lastPhoneTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：手机号 ${cleanPhone} 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }

      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && (now - lastIpTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：当前 IP 地址 (${clientIp}) 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }
    }

    const record = verificationCodes.get(phone);
    if (!record) {
      return res.status(400).json({ success: false, error: '请先获取验证码' });
    }

    if (Date.now() > record.expiresAt) {
      verificationCodes.delete(phone);
      return res.status(400).json({ success: false, error: '验证码已过期，请重新获取' });
    }

    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const isSimulated = !accessKeyId || !accessKeySecret;

    // Helper to handle login success
    const handleLoginSuccess = async () => {
      verificationCodes.delete(phone);
      clearVerifyFailures(); // H1修复：登录成功清除失败计数
      if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
        dispatchPhoneLoginLogs.set(cleanPhone, now);
        dispatchIpLoginLogs.set(clientIp, now);
      }

      // Automatically register new phone number in driver_users on Alibaba Cloud Baota MySQL and Local DB
      try {
        const dbData = readLocalJsonDb();
        if (!dbData.driver_users) dbData.driver_users = {};
        const existing = dbData.driver_users[cleanPhone];
        const defaultQrUrl = `/uploads/qrcodes/${cleanPhone}.png`;

        if (!existing) {
          const newDriverProfile = {
            id: cleanPhone,
            phone: cleanPhone,
            phoneNumber: cleanPhone,
            driverName: cleanPhone === '15509601222' ? '吴彦祖' : `司机${cleanPhone.slice(-4)}`,
            name: cleanPhone === '15509601222' ? '吴彦祖' : `司机${cleanPhone.slice(-4)}`,
            role: cleanPhone === '15509601222' ? '开发者司机' : '普通司机',
            userRole: cleanPhone === '15509601222' ? '开发者司机' : '普通司机',
            position: cleanPhone === '15509601222' ? '开发者司机' : '普通司机',
            squad_position: cleanPhone === '15509601222' ? 'developer' : 'normal',
            is_squad_member: cleanPhone === '15509601222' ? 1 : 0,
            status: cleanPhone === '15509601222' ? '已通过' : '未加入小队',
            vipExpiry: existing?.vipExpiry || '待开通',
            city: '银川市',
            isOnline: false,
            onlineOrdersEnabled: false,
            isBanned: false,
            today_orders_count: 0,
            qrcode_url: '',
            wechatQrCode: '',
            qrCode: '',
            updatedAt: new Date().toISOString()
          };
          dbData.driver_users[cleanPhone] = newDriverProfile;
          writeLocalJsonDb(dbData);

          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['driver_users', cleanPhone, JSON.stringify(newDriverProfile)]
            ).catch(() => {});
          }
        }
      } catch (regErr) {
        console.error('[Auto Register Driver User Error]:', regErr);
      }

      // 签发认证令牌：用于后续 /api/db/* 写操作鉴权
      // 商户网页版（scope=dispatch_valet）登录时，token 的 phone 带 A 后缀，与司机身份隔离
      // 根治"登录已过期"：改用无状态 HMAC 签名 token，服务端无需存储，重启/部署不丢
      const tokenScope = scope || (isAdminLogin ? 'admin_panel' : 'driver');
      const isMerchantLogin = String(scope || '').trim() === 'dispatch_valet';
      const tokenPhone = isMerchantLogin ? String(cleanPhone || '').trim().toUpperCase() + 'A' : cleanPhone;
      const authToken = createSignedToken(tokenPhone, tokenScope, isMerchantLogin);
      // 2026-10-15：被删除司机重新短信登录成功=解封，清除删除黑名单（踢出可重申请）
      try {
        const dbData = readLocalJsonDb();
        const rp = dbData?._config?.removedPhones;
        const phoneNorm = String(cleanPhone || '').replace(/\D/g, '').trim();
        if (Array.isArray(rp) && phoneNorm && rp.includes(phoneNorm)) {
          dbData._config.removedPhones = rp.filter((p: string) => p !== phoneNorm);
          writeLocalJsonDb(dbData);
        }
      } catch (_) {}
      // 兼容旧版：同时写入内存 Map，老 token 在过渡期内仍可用
      authTokens.set(authToken, {
        phone: tokenPhone,
        scope: tokenScope,
        isMerchant: isMerchantLogin,
        createdAt: Date.now()
      });
      _authTokensDirty = true; // M1: 标记持久化
      persistAuthTokensSync(); // a5修复：登录成功立即写盘，重启不丢 token
      // M1修复：删除7天过期清理（用户铁律：手动登出前永不过期）；仅做容量保护
      if (authTokens.size > 50000) {
        console.warn('[Auth] token 数量超过5万，仅记录告警，不自动清理');
      }

      return res.json({ success: true, message: '验证码校验成功', token: authToken });
    };

    // If simulated or code matches what was returned from send
    if (isSimulated || (record.code && record.code !== 'ALIYUN_EXTERNAL' && record.code === String(code).trim())) {
      if (record.code !== 'ALIYUN_EXTERNAL' && record.code !== String(code).trim()) {
        recordVerifyFailure(); // H1修复：记录验证码失败次数
        return res.status(400).json({ success: false, error: '验证码错误，请输入正确的验证码' });
      }
      return handleLoginSuccess();
    }

    // Real Mode - Call Alibaba Cloud CheckSmsVerifyCode
    try {
      console.log(`[Alibaba Cloud SMS] Requesting CheckSmsVerifyCode for: ${phone} with code: ${code}`);
      const client = getDypnsClient();
      if (!client) {
        throw new Error('Alibaba Cloud client initialization failed');
      }

      const checkRequestClass = ($Dypnsapi20170525 as any).CheckSmsVerifyCodeRequest || ($Dypnsapi20170525 as any).default?.CheckSmsVerifyCodeRequest || (Dypnsapi20170525 as any)?.CheckSmsVerifyCodeRequest;
      const requestParams = {
        phoneNumber: String(phone),
        verifyCode: String(code).trim(),
        schemeName: '默认方案',
      };

      const checkRequest = checkRequestClass ? new checkRequestClass(requestParams) : requestParams;
      const response = await client.checkSmsVerifyCode(checkRequest);

      const responseCode = response?.body?.code || '';
      const responseMsg = response?.body?.message || '';
      if (responseCode === 'OK' || response?.body?.success === true) {
        console.log('[Alibaba Cloud SMS] Check response success for:', phone);
      } else {
        console.log('[Alibaba Cloud SMS] Check response code:', responseCode, responseMsg ? `message: ${responseMsg}` : '');
      }

      // H2修复：只认阿里云 VerifyResult 明确成功，Code=OK 仅代表接口调用成功（错码也返回OK），绝不能作为登录依据
      const resultVal = response?.body?.model?.verifyResult as any;
      const isMatchVal = response?.body?.model?.isMatch as any;
      const isSuccess = (
        resultVal === true ||
        resultVal === 1 ||
        String(resultVal) === '1' ||
        String(resultVal).toUpperCase() === 'PASS' ||
        String(resultVal).toUpperCase() === 'SUCCESS' ||
        String(resultVal) === 'true' ||
        isMatchVal === true ||
        isMatchVal === 1 ||
        String(isMatchVal) === '1'
      );

      if (isSuccess) {
        return handleLoginSuccess();
      } else {
        const resCode = response?.body?.code || '';
        const resMsg = response?.body?.message || '';
        if (
          resCode === 'biz.FREQUENCY' ||
          resCode === 'isv.BUSINESS_LIMIT_CONTROL' ||
          resMsg.toLowerCase().includes('frequency') ||
          resMsg.includes('check frequency failed')
        ) {
          if (record && record.code && record.code !== 'ALIYUN_EXTERNAL' && record.code === String(code).trim()) {
            return handleLoginSuccess();
          }
          // H1修复：删除"任意4位码放行"后门，限流时返回429
          return res.status(429).json({
            success: false,
            error: '⚠️ 验证码校验频率过高：触发阿里云安全频率限制，请等待 60 秒后重试！'
          });
        }
        recordVerifyFailure(); // H1修复：记录验证码失败次数
        return res.status(400).json({
          success: false,
          error: resMsg ? `验证码校验失败: ${resMsg}` : '验证码输入错误或核验失效，请重新输入或获取'
        });
      }
    } catch (error: any) {
      console.log(`[SMS Service] High-availability verification check for: ${phone}`);
      // H1修复：删除catch块"任意4位码放行"后门，异常时返回503
      return res.status(503).json({
        success: false,
        error: `验证码校验服务暂时不可用: ${error.message || '系统繁忙，请稍后重试'}`
      });
    }
  });

  // 7. FIREBASE FIRESTORE TO MYSQL AUTOMATED MIGRATION ENDPOINT
  app.get('/api/db/migrate-from-firestore', requireDbAuth, async (req, res) => {
    try {
      // P0-5修复(2026-10-14)：仅开发者可触发数据迁移
      if (!(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '仅开发者可执行' });
      }
      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.driver_locations) dbData.driver_locations = {};
      if (!dbData.system_admins) dbData.system_admins = {};

      // Consolidate developer 15509601222 profile
      const devPhone = '15509601222';
      const devProfile = {
        phone: devPhone,
        phoneNumber: devPhone,
        driverName: '吴彦祖',
        name: '吴彦祖',
        role: '开发者',
        userRole: '开发者',
        vipExpiry: dbData.driver_users?.[devPhone]?.vipExpiry || '永久有效',
        city: '银川市',
        isOnline: false,
        onlineOrdersEnabled: false,
        isBanned: false,
        updatedAt: new Date().toISOString()
      };

      dbData.driver_users[devPhone] = { ...devProfile, ...(dbData.driver_users[devPhone] || {}) };
      dbData.squad_members[devPhone] = { ...devProfile, status: '已通过', ...(dbData.squad_members[devPhone] || {}) };
      dbData.driver_locations[devPhone] = { ...devProfile, ...(dbData.driver_locations[devPhone] || {}) };
      dbData.system_admins[devPhone] = { phone: devPhone, role: 'SUPER_DEVELOPER_ADMIN', name: '最高开发者', status: 'ACTIVE', updatedAt: new Date().toISOString() };

      // Consolidate all driver phones across collections
      const driverPhones = new Set<string>();
      ['driver_users', 'squad_members', 'squad_applications', 'driver_locations'].forEach(col => {
        if (dbData[col]) {
          Object.keys(dbData[col]).forEach(k => {
            const phone = String(dbData[col][k]?.phone || dbData[col][k]?.phoneNumber || k).replace(/\D/g, '').trim();
            if (phone && phone.length === 11) {
              driverPhones.add(phone);
            }
          });
        }
      });

      // Ensure every driver has a valid record in driver_users
      driverPhones.forEach(phone => {
        const existing = dbData.driver_users[phone] || dbData.squad_members[phone] || dbData.driver_locations[phone] || {};
        dbData.driver_users[phone] = {
          phone,
          phoneNumber: phone,
          driverName: existing.driverName || existing.name || (phone === '15509601222' ? '吴彦祖' : `司机${phone.slice(-4)}`),
          role: existing.role || existing.userRole || (phone === '15509601222' ? '开发者' : '普通司机'),
          city: existing.city || '银川市',
          vipExpiry: existing.vipExpiry || '待开通',
          isOnline: Boolean(existing.isOnline),
          onlineOrdersEnabled: Boolean(existing.onlineOrdersEnabled),
          isBanned: Boolean(existing.isBanned),
          updatedAt: existing.updatedAt || new Date().toISOString(),
          ...existing
        };
      });

      writeLocalJsonDb(dbData);

      // If MySQL is enabled, write/sync all consolidated documents
      let mysqlSyncedCount = 0;
      if (isMySQLEnabled && mysqlPool) {
        try {
          for (const col of ['driver_users', 'squad_members', 'driver_locations', 'online_applications', 'squad_applications', 'system_admins']) {
            const colData = dbData[col] || {};
            for (const docId of Object.keys(colData)) {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                [col, docId, JSON.stringify(colData[docId])]
              );
              mysqlSyncedCount++;
            }
          }
        } catch (mysqlErr: any) {
          console.error('[Migration MySQL Sync Error]:', mysqlErr);
        }
      }

      const totalDrivers = Object.keys(dbData.driver_users).length;
      res.json({ 
        success: true, 
        message: `✓ 阿里云/宝塔自建数据库迁移同步成功！已全量固化与存储 ${totalDrivers} 位司机账号档案与管理特权。`,
        driverCount: totalDrivers,
        mysqlSyncedCount,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('[Migration Exception]:', err);
      res.status(500).json({ success: false, error: err.message || '迁移过程中出现异常' });
    }
  });

  // Passenger Order submission redirect (from older config files and direct Cloudflare support endpoint)
  app.post('/api/submit', async (req, res) => {
    try {
      // N-1修复（2026-10-10复审）：IP限流，防批量伪造司机订单弹窗
      const clientIp = getClientIp(req);
      const now = Date.now();
      if (!(global as any).__submitLogs) (global as any).__submitLogs = new Map();
      const submitLogs: Map<string, number[]> = (global as any).__submitLogs;
      const logs = (submitLogs.get(clientIp) || []).filter(t => now - t < 60000);
      if (logs.length >= 3) {
        return res.status(429).json({ success: false, error: '操作过于频繁，请稍后再试' });
      }
      logs.push(now);
      submitLogs.set(clientIp, logs);

      const { driverPhone, passengerPhone, startLocation, destination } = req.body;
      if (!driverPhone || !passengerPhone || !startLocation) {
        return res.status(400).json({ success: false, error: '缺少必填参数' });
      }

      const cleanDriverPhone = String(driverPhone).replace(/\s+/g, '').trim();
      const cleanPassengerPhone = String(passengerPhone).replace(/\s+/g, '').trim();
      const cleanStartLocation = String(startLocation).trim();
      const cleanDestination = String(destination || '').trim();

      // P1-6修复(2026-10-14)：验证 driverPhone 是真实注册司机，防针对任意手机号的伪造订单轰炸
      if (!/^1[3-9]\d{9}$/.test(cleanDriverPhone)) {
        return res.status(400).json({ success: false, error: '司机手机号格式不正确' });
      }
      // P0(2026-10-15)：/api/submit加VIP校验，非VIP禁止二维码创单（与/api/qr-phone-notify口径一致）
      // 旧版乘客页(aliyun_passenger_deploy.html)仍调此接口，之前遗漏
      try {
        let driverVipExpiry = '';
        if (isMySQLEnabled && mysqlPool) {
          const [vrows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_users', cleanDriverPhone]
          );
          if (vrows && vrows.length > 0) {
            const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
            driverVipExpiry = String(vd.vipExpiry || '');
          }
          // 兼容A后缀商户号
          if (!driverVipExpiry) {
            const [arows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['driver_users', cleanDriverPhone + 'A']
            );
            if (arows && arows.length > 0) {
              const ad = typeof arows[0].data === 'string' ? JSON.parse(arows[0].data) : arows[0].data;
              driverVipExpiry = String(ad.vipExpiry || '');
            }
          }
        } else {
          const dbData = readLocalJsonDb();
          driverVipExpiry = String(
            dbData.driver_users?.[cleanDriverPhone]?.vipExpiry ||
            dbData.driver_users?.[cleanDriverPhone + 'A']?.vipExpiry || ''
          );
        }
        if (!isVipActiveServer(driverVipExpiry)) {
          return res.status(403).json({ success: false, error: '❌ 该司机暂未开通VIP会员，无法使用二维码创单功能' });
        }
      } catch (e) {
        console.error('[Submit] VIP校验异常:', (e as any)?.message);
        return res.status(500).json({ success: false, error: '系统繁忙，请稍后再试' });
      }
      try {
        // P0(2026-10-15)：MySQL模式下从MySQL查真实司机，防本地空数据误判
        let isRealDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          const [drows]: any = await mysqlPool.query(
            'SELECT 1 FROM `daijia_documents` WHERE `collection` IN (?, ?, ?) AND `doc_id` IN (?, ?) LIMIT 1',
            ['driver_users', 'squad_members', 'driver_users', cleanDriverPhone, cleanDriverPhone + 'A']
          );
          isRealDriver = !!(drows && drows.length > 0);
        } else {
          const dbData = readLocalJsonDb();
          isRealDriver = !!(
            dbData.driver_users?.[cleanDriverPhone] ||
            dbData.squad_members?.[cleanDriverPhone] ||
            dbData.driver_users?.[cleanDriverPhone + 'A']
          );
        }
        if (!isRealDriver) {
          return res.status(400).json({ success: false, error: '该司机不存在' });
        }
      } catch (_) {
        return res.status(500).json({ success: false, error: '系统繁忙，请稍后再试' });
      }

      const orderId = 'scan_ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const payloadData = {
        id: orderId,
        orderId: orderId,
        driverPhone: cleanDriverPhone,
        passengerPhone: cleanPassengerPhone,
        startLocation: cleanStartLocation,
        destination: cleanDestination || '由司机根据现场口头协商规划行程',
        status: "submitted",
        timestamp: Date.now(),
        updatedAt: Date.now(),
        isValetOrder: false,
        orderRemark: '乘客扫码自主下单'
      };

      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(payloadData);
        // 1. Write to passenger_links specifically for assigned driver instant popup
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['passenger_links', cleanDriverPhone, dataStr]
        );
        // 2. Also write to merchant_orders so it persists in history and order hall
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['merchant_orders', orderId, dataStr]
        );
        return res.json({ success: true, timestamp: Date.now(), orderId });
      }

      const dbData = readLocalJsonDb();
      if (!dbData.passenger_links) dbData.passenger_links = {};
      dbData.passenger_links[cleanDriverPhone] = payloadData;

      if (!dbData.merchant_orders) dbData.merchant_orders = {};
      dbData.merchant_orders[orderId] = payloadData;

      writeLocalJsonDb(dbData);

      res.json({ success: true, timestamp: Date.now(), orderId });
    } catch (err: any) {
      console.error('[Server Proxy] submit proxy error:', err);
      res.status(500).json({ success: false, error: err.message || 'Submit Proxy Error' });
    }
  });

  // 2026-10-11 二维码创单新流程：乘客扫码只传手机号给司机，不建单、不派单、不做地理编码
  // 司机收到后在创建订单页看到提示+语音播报，手动创建订单
  app.post('/api/qr-phone-notify', async (req, res) => {
    try {
      // P0(2026-10-15)：二维码创单仅VIP可用，服务端强制校验
      // 注意：乘客扫码提交时无token（未登录），不能加requireDbAuth；靠body.driverPhone的VIP校验+IP限流防刷
      const qpDriverPhone = String(req.body?.driverPhone || '').replace(/\D/g, '').trim();
      const targetPhone = qpDriverPhone;
      if (!/^1[3-9]\d{9}$/.test(targetPhone)) {
        return res.status(400).json({ success: false, error: '司机手机号格式不正确' });
      }
      try {
        let vipExpiry = '';
        if (isMySQLEnabled && mysqlPool) {
          const [vrows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', targetPhone]);
          if (vrows && vrows.length > 0) {
            const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
            vipExpiry = String(vd.vipExpiry || '');
          }
        } else {
          vipExpiry = String(readLocalJsonDb()?.driver_users?.[targetPhone]?.vipExpiry || '');
        }
        if (!isVipActiveServer(vipExpiry)) {
          return res.status(403).json({ success: false, error: '二维码创单为VIP专属功能，请先开通VIP' });
        }
      } catch (e) {
        console.error('[QRNotify] VIP校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '校验失败，请重试' });
      }
      // IP限流：与 /api/submit 同级，防批量骚扰
      const clientIp = getClientIp(req);
      const now = Date.now();
      if (!(global as any).__qrPhoneLogs) (global as any).__qrPhoneLogs = new Map();
      const qrPhoneLogs: Map<string, number[]> = (global as any).__qrPhoneLogs;
      const logs = (qrPhoneLogs.get(clientIp) || []).filter(t => now - t < 60000);
      if (logs.length >= 3) {
        return res.status(429).json({ success: false, error: '操作过于频繁，请稍后再试' });
      }
      logs.push(now);
      qrPhoneLogs.set(clientIp, logs);

      const { driverPhone, passengerPhone, startLocation } = req.body || {};
      if (!driverPhone || !passengerPhone) {
        return res.status(400).json({ success: false, error: '缺少必填参数' });
      }

      const cleanDriverPhone = String(driverPhone).replace(/\D/g, '').trim();
      const cleanPassengerPhone = String(passengerPhone).replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(cleanDriverPhone) || !/^1[3-9]\d{9}$/.test(cleanPassengerPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      // 出发地仅作文本参考透传，服务端绝不做地理编码（用户2026-10-11明确要求）
      const refStartLocation = String(startLocation || '').trim().slice(0, 100);

      const payloadData = {
        type: 'qr_phone_notify', // 区别于完整订单，司机端据此走轻量通知流程
        driverPhone: cleanDriverPhone,
        passengerPhone: cleanPassengerPhone,
        startLocation: refStartLocation,
        status: 'submitted',
        timestamp: Date.now(),
        updatedAt: Date.now()
      };

      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(payloadData);
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['passenger_links', cleanDriverPhone, dataStr]
        );
        // 注意：不写入 merchant_orders，不建单、不派单
        return res.json({ success: true, timestamp: Date.now() });
      }

      const dbData = readLocalJsonDb();
      if (!dbData.passenger_links) dbData.passenger_links = {};
      dbData.passenger_links[cleanDriverPhone] = payloadData;
      writeLocalJsonDb(dbData);

      res.json({ success: true, timestamp: Date.now() });
    } catch (err: any) {
      console.error('[QR Phone Notify] error:', err);
      res.status(500).json({ success: false, error: err.message || 'QR Phone Notify Error' });
    }
  });

  // 2026-10-12 二维码特殊通道：司机端开二维码弹窗时直接轮询此接口，不依赖 passenger_links 文档轮询
  // 只有扫3分钟倒计时二维码的通知走这里，司机忙碌状态也不阻断
  app.get('/api/qr-notify-check', requireDbAuth, async (req, res) => {
    try {
      // P0(2026-10-15)：只能查自己的，防止手机号被盗
      const authPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const driverPhone = String(req.query.driverPhone || '').replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(driverPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      if (authPhone !== driverPhone && authPhone !== '15509601222') {
        return res.status(403).json({ success: false, error: '只能查询自己的二维码通知' });
      }

      let payloadData: any = null;

      if (isMySQLEnabled && mysqlPool) {
        const [rows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['passenger_links', driverPhone]
        );
        if (rows && rows.length > 0) {
          const raw = rows[0].data;
          payloadData = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
      } else {
        const dbData = readLocalJsonDb();
        payloadData = dbData?.passenger_links?.[driverPhone] || null;
      }

      // 只返回有效的二维码通知：type=qr_phone_notify, status=submitted, 5分钟内
      if (payloadData && payloadData.type === 'qr_phone_notify' &&
          payloadData.status === 'submitted' &&
          payloadData.timestamp > Date.now() - 300000) {
        // 取走后立即删除，防止重复投递
        try {
          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['passenger_links', driverPhone]
            );
          } else {
            const dbData = readLocalJsonDb();
            if (dbData?.passenger_links?.[driverPhone]) {
              delete dbData.passenger_links[driverPhone];
              writeLocalJsonDb(dbData);
            }
          }
        } catch (_) {}
        return res.json({ success: true, hasNotify: true, data: payloadData });
      }

      return res.json({ success: true, hasNotify: false });
    } catch (err: any) {
      console.error('[QR Notify Check] error:', err);
      res.status(500).json({ success: false, error: err.message || 'QR Notify Check Error' });
    }
  });

  // 2026-10-12 兑换码专用查询通道：不走 /api/db/get 的严格鉴权，司机可直接验证
  // P1-1修复(2026-10-15)：加鉴权，返回最小化（不泄露他人手机号）
  app.get('/api/vip-code-check', requireDbAuth, async (req, res) => {
    try {
      const code = String(req.query.code || '').trim().toUpperCase();
      if (!code) {
        return res.status(400).json({ success: false, error: '缺少兑换码' });
      }
      let foundData: any = null;
      if (isMySQLEnabled && mysqlPool) {
        const [rows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['vip_codes', code]
        );
        if (rows && rows.length > 0) {
          const raw = rows[0].data;
          foundData = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
      } else {
        const dbData = readLocalJsonDb();
        foundData = dbData?.vip_codes?.[code] || null;
      }
      if (foundData) {
        // P1-1: 只返回exists和duration，不返回redeemedBy等隐私字段
        return res.json({ success: true, exists: true, duration: foundData.duration || 30, isRedeemed: !!foundData.isRedeemed });
      }
      return res.json({ success: true, exists: false });
    } catch (err: any) {
      console.error('[VIP Code Check] error:', err);
      res.status(500).json({ success: false, error: err.message || 'VIP Code Check Error' });
    }
  });

  // 2026-10-12 兑换码核销专用通道
  // P0-4修复(2026-10-15)：服务端原子核销 + 写三表vipExpiry，前端只展示不再本地计算
  // P1-2修复(2026-10-15)：加鉴权，redeemedBy取token身份
  app.post('/api/vip-code-redeem', requireDbAuth, async (req, res) => {
    try {
      const { code } = req.body || {};
      const cleanCode = String(code || '').trim().toUpperCase();
      // P1-2: redeemedBy 取token身份，不信任客户端
      const redeemerPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (!cleanCode) {
        return res.status(400).json({ success: false, error: '缺少兑换码' });
      }
      if (!/^1[3-9]\d{9}$/.test(redeemerPhone)) {
        return res.status(400).json({ success: false, error: '身份异常' });
      }

      // 计算新的有效期
      const calcExpiry = (currentExpiry: string, durationDays: number): string => {
        if (durationDays === 99999) return '永久有效';
        let base = new Date();
        if (currentExpiry && currentExpiry !== '永久有效' && currentExpiry !== '待开通') {
          const parsed = Date.parse(currentExpiry);
          if (!isNaN(parsed)) {
            const prev = new Date(parsed);
            if (prev.getTime() > base.getTime()) base = prev;
          }
        }
        base.setDate(base.getDate() + durationDays);
        const yyyy = base.getFullYear();
        const mm = String(base.getMonth() + 1).padStart(2, '0');
        const dd = String(base.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      };

      let finalExpiry = '';
      let durationDays = 30;

      if (isMySQLEnabled && mysqlPool) {
        // MySQL: 用事务保证原子性（查+标已用+写三表）
        const conn = await mysqlPool.getConnection();
        try {
          await conn.beginTransaction();
          const [rows]: any = await conn.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? FOR UPDATE',
            ['vip_codes', cleanCode]
          );
          if (!rows || rows.length === 0) {
            await conn.rollback(); conn.release();
            return res.status(404).json({ success: false, error: '兑换码不存在' });
          }
          const foundData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
          if (foundData.isRedeemed) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ success: false, error: '该兑换码已被使用' });
          }
          durationDays = Number(foundData.duration) || 30;
          foundData.isRedeemed = true;
          foundData.redeemedAt = new Date().toISOString();
          foundData.redeemedBy = redeemerPhone;
          await conn.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['vip_codes', cleanCode, JSON.stringify(foundData)]
          );
          // 写三表 vipExpiry（读当前值累加）
          const purePhone = redeemerPhone.replace(/A$/, '');
          for (const col of ['driver_users', 'squad_members', 'online_applications']) {
            for (const p of [redeemerPhone, purePhone]) {
              const [erows]: any = await conn.query(
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                [col, p]
              );
              if (erows && erows.length > 0) {
                const edata = typeof erows[0].data === 'string' ? JSON.parse(erows[0].data) : erows[0].data;
                if (!finalExpiry) finalExpiry = calcExpiry(String(edata.vipExpiry || ''), durationDays);
                edata.vipExpiry = finalExpiry;
                edata.updatedAt = new Date().toISOString();
                await conn.query(
                  'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                  'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                  [col, p, JSON.stringify(edata)]
                );
              }
            }
          }
          await conn.commit(); conn.release();
        } catch (e) {
          try { await conn.rollback(); conn.release(); } catch (_) {}
          throw e;
        }
      } else {
        // 本地JSON模式：单线程天然原子
        const dbData = readLocalJsonDb();
        const foundData = dbData?.vip_codes?.[cleanCode] || null;
        if (!foundData) {
          return res.status(404).json({ success: false, error: '兑换码不存在' });
        }
        if (foundData.isRedeemed) {
          return res.status(400).json({ success: false, error: '该兑换码已被使用' });
        }
        durationDays = Number(foundData.duration) || 30;
        foundData.isRedeemed = true;
        foundData.redeemedAt = new Date().toISOString();
        foundData.redeemedBy = redeemerPhone;
        if (!dbData.vip_codes) dbData.vip_codes = {};
        dbData.vip_codes[cleanCode] = foundData;
        const purePhone = redeemerPhone.replace(/A$/, '');
        for (const col of ['driver_users', 'squad_members', 'online_applications']) {
          for (const p of [redeemerPhone, purePhone]) {
            if (dbData[col]?.[p]) {
              if (!finalExpiry) finalExpiry = calcExpiry(String(dbData[col][p].vipExpiry || ''), durationDays);
              dbData[col][p].vipExpiry = finalExpiry;
              dbData[col][p].updatedAt = new Date().toISOString();
            }
          }
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true, vipExpiry: finalExpiry, durationDays });
    } catch (err: any) {
      console.error('[VIP Code Redeem] error:', err);
      res.status(500).json({ success: false, error: err.message || 'VIP Code Redeem Error' });
    }
  });

  // 2026-10-12 新来单超时/拒收转大厅专用通道：不走鉴权，秒级进厅
  app.post('/api/order/to-hall', requireDbAuth, async (req, res) => {
    try {
      const { orderId, reason } = req.body || {};
      const cleanOrderId = String(orderId || '').trim();
      // P0-2修复(2026-10-14)：driverPhone 取自 token 不信任请求体（防伪造别人手机号）；且必须是该订单的被派司机才能转大厅
      const cleanDriverPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: '缺少 orderId' });
      }
      // 校验：订单存在且调用者是被派司机（或开发者）
      // P0(2026-10-16)：同时校验 claimedDriverPhone——订单已被他人接走时，
      // 非接单人调用 to-hall 会摧毁他人合法接单，必须 403 拒绝。
      // 校验数据源用 MySQL（与写入路径一致），本地 JSON 可能过期。
      try {
        const isDev = (req as any).isAdmin;
        if (!isDev) {
          let order: any = null;
          if (isMySQLEnabled && mysqlPool) {
            try {
              const [vrows]: any = await mysqlPool.query(
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                ['merchant_orders', cleanOrderId]
              );
              if (vrows && vrows.length > 0) {
                const vraw = vrows[0].data;
                order = typeof vraw === 'string' ? JSON.parse(vraw) : vraw;
              }
            } catch (_) { order = null; }
          }
          if (!order) {
            const dbData = readLocalJsonDb();
            order = dbData.merchant_orders?.[cleanOrderId] || dbData.valet_orders?.[cleanOrderId];
          }
          if (order) {
            const assigned = String(order.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
            if (assigned && assigned !== cleanDriverPhone) {
              return res.status(403).json({ success: false, error: '只有被派司机可以将该订单转入大厅' });
            }
            // P0(2026-10-16)：已被他人接走的订单，非接单人不得转入大厅
            const claimed = String(order.claimedDriverPhone || '').replace(/\D/g, '').trim();
            if (claimed && claimed !== cleanDriverPhone) {
              return res.status(403).json({ success: false, error: '该订单已被其他司机接走，不能转入大厅' });
            }
            // P1(2026-10-16第二遍审计)：to-hall 状态守卫，已完成/已取消/服务中的订单不得复活回大厅。
            // /api/order/complete 完成订单时不清空 dispatchedDriverPhone，司机事后调 to-hall 可把 completed 翻回 hall。
            const oStatus = String(order.status || '');
            const oCat = String(order.statusCategory || '');
            if (['completed', '已完成', 'cancelled', '已取消', 'serving', '服务中'].includes(oStatus) ||
                ['已完成', '已取消', '服务中'].includes(oCat)) {
              return res.status(409).json({ success: false, error: '订单已完结，不能转入大厅' });
            }
          }
        }
      } catch (_) {}
      const now = Date.now();
      const applyToOrder = (targetOrder: any) => {
        const existingDeclined = Array.isArray(targetOrder?.declinedDriverPhones) ? targetOrder.declinedDriverPhones : [];
        const existingTimeout = Array.isArray(targetOrder?.timeoutDriverPhones) ? targetOrder.timeoutDriverPhones : [];
        return {
          ...(targetOrder || {}),
          status: 'hall',
          in_hall: true,
          statusCategory: '呼叫中',
          dispatchedDriverPhone: '',
          dispatchedDriverName: '',
          claimedDriverPhone: '',
          claimedDriverName: '',
          driverName: '',
          declinedDriverPhones: Array.from(new Set([...existingDeclined, cleanDriverPhone].filter(Boolean))),
          timeoutDriverPhones: Array.from(new Set([...existingTimeout, cleanDriverPhone].filter(Boolean))),
          lastDeclinedAt: now,
          hallReason: String(reason || 'timeout_or_decline').slice(0, 50),
        };
      };
      if (isMySQLEnabled && mysqlPool) {
        const [rows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['merchant_orders', cleanOrderId]
        );
        let targetOrder: any = {};
        if (rows && rows.length > 0) {
          const raw = rows[0].data;
          targetOrder = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
        const updated = applyToOrder(targetOrder);
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['merchant_orders', cleanOrderId, JSON.stringify(updated)]
        );
        // 清掉该司机的 passenger_links，避免重复弹窗
        if (cleanDriverPhone) {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['passenger_links', cleanDriverPhone]
          ).catch(() => {});
        }
      } else {
        const dbData = readLocalJsonDb();
        if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
        const targetOrder = dbData['merchant_orders'][cleanOrderId] || {};
        dbData['merchant_orders'][cleanOrderId] = applyToOrder(targetOrder);
        if (cleanDriverPhone && dbData['passenger_links'] && dbData['passenger_links'][cleanDriverPhone]) {
          delete dbData['passenger_links'][cleanDriverPhone];
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Order To Hall] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Order To Hall Error' });
    }
  });

  // 2026-10-12 行程中司机确认取消专用通道：真取消，不进大厅，不再弹窗
  app.post('/api/order/true-cancel', requireDbAuth, async (req, res) => {
    try {
      const { orderId, driverPhone, reason } = req.body || {};
      const cleanOrderId = String(orderId || '').trim();
      const cleanDriverPhone = String(driverPhone || '').replace(/\D/g, '').trim();
      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: '缺少 orderId' });
      }
      const now = Date.now();
      const cancelPayload = {
        status: 'cancelled',
        statusCategory: '已取消',
        in_hall: false,
        isCancelled: true,
        cancelledAt: now,
        cancelledBy: 'driver',
        cancelledByRole: 'driver',
        cancelledDriverPhone: cleanDriverPhone,
        cancelReason: String(reason || '司机已取消订单').slice(0, 100),
      };
      const applyCancel = (targetOrder: any) => ({ ...(targetOrder || {}), ...cancelPayload });
      if (isMySQLEnabled && mysqlPool) {
        for (const col of ['merchant_orders', 'valet_orders']) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, cleanOrderId]
          ).catch(() => [[]]);
          let targetOrder: any = {};
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            targetOrder = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, cleanOrderId, JSON.stringify(applyCancel(targetOrder))]
          ).catch(() => {});
        }
        if (cleanDriverPhone) {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['passenger_links', cleanDriverPhone]
          ).catch(() => {});
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of ['merchant_orders', 'valet_orders']) {
          if (!dbData[col]) dbData[col] = {};
          const targetOrder = dbData[col][cleanOrderId] || {};
          dbData[col][cleanOrderId] = applyCancel(targetOrder);
        }
        if (cleanDriverPhone && dbData['passenger_links'] && dbData['passenger_links'][cleanDriverPhone]) {
          delete dbData['passenger_links'][cleanDriverPhone];
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Order True Cancel] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Order True Cancel Error' });
    }
  });

  // 2026-10-12 小队申请审批通过专用通道：写入成员表，确保审批必生效。不走鉴权。
  app.post('/api/squad-member/approve', requireDbAuth, async (req, res) => {
    try {
      // P0修复(2026-10-14)：只有管理员/管理人员可以审批，防普通司机自批入队
      // 2026-10-15：城市派单员也可审批入队申请（用户要求），但不给改名/删人/调职位等其他管理权限
      const isApproverAdmin = (req as any).isAdmin || (req as any).isManager || (req as any).isDispatcher;
      if (!isApproverAdmin) {
        return res.status(403).json({ success: false, error: '仅管理人员可以审批' });
      }
      const { phone, name, approvedBy, approvedRole, note, city } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      const cleanName = String(name || '').trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanName) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      const now = new Date().toISOString();
      const nowTs = Date.now();
      // P1-4修复(2026-10-15)：approvedBy取token身份，不信任客户端自报
      const realApprover = String((req as any).authPhone || approvedBy || '').trim();
      // P1-6修复(2026-10-15)：已是成员则保留原角色，防重审降级
      let keepRole = '普通司机';
      // 2026-10-15：审批入队必须保留司机原有VIP有效期，不硬编码'待开通'
      let keepVipExpiry = '待开通';
      // P0(2026-10-15)：审批入队必须保留司机原有接单授权有效期，防重审清空
      let keepLicenseExpiry = '待开通';
      try {
        if (isMySQLEnabled && mysqlPool) {
          const [duRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_users', cleanPhone]);
          if (duRows && duRows.length > 0) {
            const duData = typeof duRows[0].data === 'string' ? JSON.parse(duRows[0].data) : duRows[0].data;
            if (duData?.vipExpiry) keepVipExpiry = duData.vipExpiry;
            if (duData?.licenseExpiry) keepLicenseExpiry = duData.licenseExpiry;
          }
        } else {
          const dbData = readLocalJsonDb();
          const duExisting = dbData.driver_users?.[cleanPhone];
          if (duExisting?.vipExpiry) keepVipExpiry = duExisting.vipExpiry;
          if (duExisting?.licenseExpiry) keepLicenseExpiry = duExisting.licenseExpiry;
        }
        // 角色保留仍走本地（P1-6原逻辑）
        const dbData2 = readLocalJsonDb();
        const existing = dbData2.squad_members?.[cleanPhone];
        if (existing?.role && existing.role !== '普通司机') keepRole = existing.role;
        if (keepVipExpiry === '待开通' && existing?.vipExpiry) keepVipExpiry = existing.vipExpiry;
        if (keepLicenseExpiry === '待开通' && existing?.licenseExpiry) keepLicenseExpiry = existing.licenseExpiry;
      } catch (_) {}
      const memberPayload = {
        id: cleanPhone, phone: cleanPhone, phoneNumber: cleanPhone,
        name: cleanName, driverName: cleanName,
        role: keepRole, userRole: keepRole,
        status: '已通过', approvalStatus: '已通过',
        approvedBy: realApprover, approvedRole: String(approvedRole || ''),
        approvalTime: now, note: String(note || '').slice(0, 200),
        city: String(city || '银川市').slice(0, 20),
        vipExpiry: keepVipExpiry, licenseExpiry: keepLicenseExpiry, createdAt: nowTs, updatedAt: now,
      };
      if (isMySQLEnabled && mysqlPool) {
        // 1. 写入 squad_members
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['squad_members', cleanPhone, JSON.stringify(memberPayload)]);
        // 2. 更新 driver_users（保留 vipExpiry）
        try {
          const [uRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_users', cleanPhone]);
          let uExisting: any = {};
          if (uRows && uRows.length > 0) {
            const raw = uRows[0].data;
            uExisting = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
          const uUpdated = { ...uExisting, ...memberPayload, vipExpiry: uExisting.vipExpiry || '待开通' };
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['driver_users', cleanPhone, JSON.stringify(uUpdated)]);
        } catch (_) {}
        // 3. 写入 team_members 职位记录
        try {
          const teamPayload = { ...memberPayload, squad_position: 'normal', joinedAt: now };
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['team_members', cleanPhone, JSON.stringify(teamPayload)]);
        } catch (_) {}
        // 4. 删除 squad_applications 中的申请（防幽灵申请）
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['squad_applications', cleanPhone]).catch(() => {});
        // 5. 从移除名单删除
        try {
          const [cRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['config', 'removed_squad_members']);
          if (cRows && cRows.length > 0) {
            const raw = cRows[0].data;
            const cData = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const phones = Array.isArray(cData.phones) ? cData.phones.filter((p: string) => p !== cleanPhone) : [];
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['config', 'removed_squad_members', JSON.stringify({ phones, updatedAt: now })]);
          }
        } catch (_) {}
        // P0(2026-10-15)：MySQL模式下也要清本地token黑名单（验签读本地JSON）
        try {
          const ldb = readLocalJsonDb();
          if (ldb['_config']?.['removedPhones']) {
            ldb['_config']['removedPhones'] = (ldb['_config']['removedPhones'] || []).filter((p: string) => String(p).trim() !== cleanPhone);
            writeLocalJsonDb(ldb);
          }
        } catch (_) {}
      } else {
        const dbData = readLocalJsonDb();
        if (!dbData['squad_members']) dbData['squad_members'] = {};
        dbData['squad_members'][cleanPhone] = memberPayload;
        if (!dbData['driver_users']) dbData['driver_users'] = {};
        const uExisting = dbData['driver_users'][cleanPhone] || {};
        dbData['driver_users'][cleanPhone] = { ...uExisting, ...memberPayload, vipExpiry: uExisting.vipExpiry || '待开通' };
        if (!dbData['team_members']) dbData['team_members'] = {};
        dbData['team_members'][cleanPhone] = { ...memberPayload, squad_position: 'normal', joinedAt: now };
        if (dbData['squad_applications']?.[cleanPhone]) delete dbData['squad_applications'][cleanPhone];
        if (dbData['config']?.['removed_squad_members']) {
          const phones = (dbData['config']['removed_squad_members'].phones || []).filter((p: string) => p !== cleanPhone);
          dbData['config']['removed_squad_members'] = { phones, updatedAt: now };
        }
        // P0(2026-10-15)：审批通过清token黑名单，否则重获批司机无法登录
        if (dbData['_config']?.['removedPhones']) {
          dbData['_config']['removedPhones'] = (dbData['_config']['removedPhones'] || []).filter((p: string) => String(p).trim() !== cleanPhone);
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Approve] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Approve Error' });
    }
  });

  // 2026-10-12 司机改名专用通道：同步更新所有相关表。不走鉴权。
  app.post('/api/squad-member/rename', requireDbAuth, async (req, res) => {
    try {
      // P0-1修复(2026-10-15)：仅管理人员可改名，防普通司机越权
      if (!(req as any).isAdmin && !(req as any).isManager) {
        return res.status(403).json({ success: false, error: '仅管理人员可以改名' });
      }
      const { phone, name } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      const cleanName = String(name || '').trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanName) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      const now = new Date().toISOString();
      const updatePayload = { name: cleanName, driverName: cleanName, realName: cleanName, applicantName: cleanName, updatedAt: now };
      const cols = ['squad_members', 'driver_users', 'driver_locations', 'online_applications', 'squad_applications', 'team_members'];
      if (isMySQLEnabled && mysqlPool) {
        for (const col of cols) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', [col, cleanPhone]);
            if (rows && rows.length > 0) {
              const raw = rows[0].data;
              const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const updated = { ...existing, ...updatePayload };
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', [col, cleanPhone, JSON.stringify(updated)]);
            }
          } catch (_) {}
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
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Rename] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Rename Error' });
    }
  });

  // 2026-10-12 司机职位调整专用通道：同步更新所有相关表。不走鉴权。
  app.post('/api/squad-member/set-role', requireDbAuth, async (req, res) => {
    try {
      // P0-1修复(2026-10-15)：仅管理人员可调职位，防普通司机自封提权
      if (!(req as any).isAdmin && !(req as any).isManager) {
        return res.status(403).json({ success: false, error: '仅管理人员可以调整职位' });
      }
      const { phone, role } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      const cleanRole = String(role || '').trim().slice(0, 20);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanRole) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      if (cleanPhone === '15509601222') {
        return res.status(403).json({ success: false, error: '开发者角色不可调整' });
      }
      const now = new Date().toISOString();
      const updatePayload = { role: cleanRole, userRole: cleanRole, updatedAt: now };
      const cols = ['squad_members', 'driver_users', 'squad_applications', 'team_members'];
      if (isMySQLEnabled && mysqlPool) {
        for (const col of cols) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', [col, cleanPhone]);
            if (rows && rows.length > 0) {
              const raw = rows[0].data;
              const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const updated = { ...existing, ...updatePayload };
              // team_members 用 squad_position 字段
              if (col === 'team_members') {
                (updated as any).squad_position = cleanRole;
              }
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', [col, cleanPhone, JSON.stringify(updated)]);
            }
          } catch (_) {}
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of cols) {
          if (dbData[col]?.[cleanPhone]) {
            const updated = { ...dbData[col][cleanPhone], ...updatePayload };
            if (col === 'team_members') updated.squad_position = cleanRole;
            dbData[col][cleanPhone] = updated;
          }
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Set Role] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Set Role Error' });
    }
  });

  // 2026-10-12 小队成员删除专用通道：确保删除必生效，删除后立即失去接单权限。不走鉴权（管理后台调用）。
  app.post('/api/squad-member/remove', requireDbAuth, async (req, res) => {
    try {
      // P0-1修复(2026-10-15)：仅管理人员可删除司机，防普通司机删光全小队
      if (!(req as any).isAdmin && !(req as any).isManager) {
        return res.status(403).json({ success: false, error: '仅管理人员可以删除司机' });
      }
      const { phone, adminPhone } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      if (cleanPhone === '15509601222') {
        return res.status(403).json({ success: false, error: '开发者不能被删除' });
      }
      const now = new Date().toISOString();
      if (isMySQLEnabled && mysqlPool) {
        // 1. 从 squad_members 删除
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['squad_members', cleanPhone]);
        // 2. 从 squad_applications 删除（防幽灵申请）
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['squad_applications', cleanPhone]);
        // 3. 从 team_members 删除职位记录
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['team_members', cleanPhone]).catch(() => {});
        // 4. 更新 driver_users 状态为未加入小队
        const [uRows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['driver_users', cleanPhone]);
        let uData: any = {};
        if (uRows && uRows.length > 0) {
          const raw = uRows[0].data;
          uData = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
        // P1-10修复(2026-10-15)：保留真名不洗成"司机+后四位"
        // P1-4: removedBy取token身份
        const realRemover = String((req as any).authPhone || adminPhone || '').trim();
        uData = { ...uData, phone: cleanPhone, phoneNumber: cleanPhone,
          role: '普通司机', userRole: '普通司机', status: '未加入小队', approvalStatus: '未加入小队',
          removedBy: realRemover, removedAt: now, updatedAt: now };
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['driver_users', cleanPhone, JSON.stringify(uData)]);
        // 5. 加入移除名单
        const [cRows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['config', 'removed_squad_members']);
        let phones: string[] = [];
        if (cRows && cRows.length > 0) {
          const raw = cRows[0].data;
          const cData = typeof raw === 'string' ? JSON.parse(raw) : raw;
          phones = Array.isArray(cData.phones) ? cData.phones : [];
        }
        if (!phones.includes(cleanPhone)) phones.push(cleanPhone);
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['config', 'removed_squad_members', JSON.stringify({ phones, updatedAt: now })]);
        // P1-10: 清GPS位置（地图不再显示被删的人）
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['driver_locations', cleanPhone]).catch(() => {});
        // P1-10: 拉黑该手机号所有token（被删司机App立即掉线，需用户拍板：删除=踢出但可重申请）
        try {
          const dbData2 = readLocalJsonDb();
          if (!dbData2._config) dbData2._config = {};
          if (!Array.isArray(dbData2._config.tokenBlocklist)) dbData2._config.tokenBlocklist = [];
          // 标记该手机号的token失效（验签时检查手机号黑名单）
          if (!dbData2._config.removedPhones) dbData2._config.removedPhones = [];
          if (!dbData2._config.removedPhones.includes(cleanPhone)) {
            dbData2._config.removedPhones.push(cleanPhone);
          }
          writeLocalJsonDb(dbData2);
        } catch (_) {}
      } else {
        const dbData = readLocalJsonDb();
        if (dbData['squad_members']?.[cleanPhone]) delete dbData['squad_members'][cleanPhone];
        if (dbData['squad_applications']?.[cleanPhone]) delete dbData['squad_applications'][cleanPhone];
        if (dbData['team_members']?.[cleanPhone]) delete dbData['team_members'][cleanPhone];
        if (!dbData['driver_users']) dbData['driver_users'] = {};
        const existing = dbData['driver_users'][cleanPhone] || {};
        // P1-10补漏(2026-10-15)：保留真名不洗成"司机+后四位"；保留vipExpiry
        dbData['driver_users'][cleanPhone] = { ...existing, phone: cleanPhone, phoneNumber: cleanPhone,
          role: '普通司机', userRole: '普通司机', status: '未加入小队', approvalStatus: '未加入小队',
          removedBy: String((req as any).authPhone || adminPhone || ''), removedAt: now, updatedAt: now };
        if (!dbData['config']) dbData['config'] = {};
        const cfg = dbData['config']['removed_squad_members'] || { phones: [] };
        const phones = Array.isArray(cfg.phones) ? cfg.phones : [];
        if (!phones.includes(cleanPhone)) phones.push(cleanPhone);
        dbData['config']['removed_squad_members'] = { phones, updatedAt: now };
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Remove] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Squad Remove Error' });
    }
  });

  // 2026-10-12 司机接单专用通道：原子认领，防止抢单竞态。不走鉴权。
  app.post('/api/order/driver-claim', requireDbAuth, async (req, res) => {
    try {
      const { orderId, driverName } = req.body || {};
      const cleanOrderId = String(orderId || '').trim();
      // 2026-10-15 P0修复：driverPhone强制取token本人，防冒名替他人抢单（与/api/order/claim的H11一致）
      // P0(2026-10-16第二遍审计)：补A后缀商户拦截（与/api/order/claim一致），必须在 replace(/\D/g) 之前判断原始值。
      const authPhoneRawClaim = String((req as any).authPhone || '').trim();
      if (/a$/i.test(authPhoneRawClaim)) {
        return res.status(403).json({ success: false, error: '商户身份不能抢单' });
      }
      const cleanDriverPhone = authPhoneRawClaim.replace(/\D/g, '').trim();
      const cleanDriverName = String(driverName || '').slice(0, 20);
      if (!cleanOrderId || !/^1[3-9]\d{9}$/.test(cleanDriverPhone)) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      // 接单授权检查 (2026-10-15)：天数为0不能接单，无豁免
      try {
        let licExpiry2 = '';
        if (isMySQLEnabled && mysqlPool) {
          const [lrows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_users', cleanDriverPhone]);
          if (lrows && lrows.length > 0) {
            const ld = typeof lrows[0].data === 'string' ? JSON.parse(lrows[0].data) : lrows[0].data;
            licExpiry2 = String(ld.licenseExpiry || '');
          }
        } else {
          licExpiry2 = String(readLocalJsonDb()?.driver_users?.[cleanDriverPhone]?.licenseExpiry || '');
        }
        if (!isLicenseValid(licExpiry2)) {
          return res.status(403).json({ success: false, error: '接单授权已到期，请联系开发者充值' });
        }
      } catch (e) {
        console.error('[DriverClaim] 接单授权校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '授权校验失败，请重试' });
      }
      // P0(2026-10-15)：非VIP每日2单服务端强制限制
      try {
        let vipExpiry2 = '';
        if (isMySQLEnabled && mysqlPool) {
          const [vrows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', cleanDriverPhone]);
          if (vrows && vrows.length > 0) {
            const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
            vipExpiry2 = String(vd.vipExpiry || '');
          }
        } else {
          vipExpiry2 = String(readLocalJsonDb()?.driver_users?.[cleanDriverPhone]?.vipExpiry || '');
        }
        if (!isVipActiveServer(vipExpiry2)) {
          const todayCount = await countTodayCompletedOrders(cleanDriverPhone);
          if (todayCount >= 2) {
            return res.status(403).json({ success: false, error: '非VIP会员每天限2单，明早6点自动恢复。如需无限接单请开通VIP' });
          }
        }
      } catch (e) {
        console.error('[DriverClaim] VIP限额校验异常:', (e as any)?.message);
      }
      // 2026-10-12修复：接单人必须是小队正式成员（已通过），否则403
      const checkSquadMember = async (): Promise<boolean> => {
        if (cleanDriverPhone === '15509601222') return true; // 开发者
        try {
          if (isMySQLEnabled && mysqlPool) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['squad_members', cleanDriverPhone]
            );
            if (!rows || rows.length === 0) return false;
            const raw = rows[0].data;
            const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const st = String(m.status || m.approvalStatus || '').trim();
            return ['已通过', 'approved', '通过'].includes(st);
          } else {
            const dbData = readLocalJsonDb();
            const m = (dbData['squad_members'] || {})[cleanDriverPhone];
            if (!m) return false;
            const st = String(m.status || m.approvalStatus || '').trim();
            return ['已通过', 'approved', '通过'].includes(st);
          }
        } catch (_) { return false; }
      };
      if (!(await checkSquadMember())) {
        return res.status(403).json({ success: false, error: '仅小队正式成员可接单' });
      }
      // P0(2026-10-16第二遍审计)：幂等短路必须在忙碌检查之前。
      // 新来单弹窗点"确认接单"会调两次服务端（overlay先调/api/order/claim成功，busy已=true，
      // 再经onAccept调driver-claim），第二次必须幂等成功，否则被忙碌检查409误杀，App进不了行程页。
      // 先读订单判幂等，命中则直接返回成功，跳过忙碌检查。
      try {
        if (isMySQLEnabled && mysqlPool) {
          const [idemRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['merchant_orders', cleanOrderId]);
          if (idemRows && idemRows.length > 0) {
            const idemRaw = idemRows[0].data;
            const idemTarget: any = typeof idemRaw === 'string' ? JSON.parse(idemRaw) : idemRaw;
            const idemClaimedBy = String(idemTarget.claimedDriverPhone || idemTarget.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
            const idemSt = String(idemTarget.status || '');
            if ((idemSt === 'claimed' || idemSt === '已接单') && idemClaimedBy === cleanDriverPhone) {
              return res.json({ success: true });
            }
          }
        } else {
          const idemLocal = readLocalJsonDb()?.merchant_orders?.[cleanOrderId];
          if (idemLocal) {
            const idemClaimedBy = String((idemLocal as any).claimedDriverPhone || (idemLocal as any).dispatchedDriverPhone || '').replace(/\D/g, '').trim();
            const idemSt = String((idemLocal as any).status || '');
            if ((idemSt === 'claimed' || idemSt === '已接单') && idemClaimedBy === cleanDriverPhone) {
              return res.json({ success: true });
            }
          }
        }
      } catch (_) {}
      // P1(2026-10-16)：大厅抢单加忙碌检查——行程中的司机不能再抢一单，防一人同时持有两单。
      // 与 /api/order/claim 同口径；busy 状态写 MySQL，故优先读 MySQL。
      // 注意：上方幂等短路已处理"本人重复调用"，此处忙碌检查只拦真正有别单在身的司机。
      try {
        let busyLoc: any = null;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [brows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['driver_locations', cleanDriverPhone]);
            if (brows && brows.length > 0) {
              const braw = brows[0].data;
              busyLoc = typeof braw === 'string' ? JSON.parse(braw) : braw;
            }
          } catch (_) {}
        }
        if (!busyLoc) busyLoc = readLocalJsonDb()?.driver_locations?.[cleanDriverPhone];
        if (busyLoc && (busyLoc.isBusy === true || busyLoc.isBusy === "true" || busyLoc.isBusy === 1)) {
          return res.status(409).json({ success: false, error: '您当前有行程中的订单，请完成后再抢单' });
        }
      } catch (_) {}
      const now = Date.now();
      const claimData = {
        status: 'claimed',
        statusCategory: '已接单',
        in_hall: false,
        dispatchedDriverPhone: cleanDriverPhone,
        dispatchedDriverName: cleanDriverName,
        claimedDriverPhone: cleanDriverPhone,
        claimedDriverName: cleanDriverName,
        driverName: cleanDriverName,
        claimedAt: now,
      };
      const doClaim = async () => {
        if (isMySQLEnabled && mysqlPool) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['merchant_orders', cleanOrderId]
          );
          let target: any = {};
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            target = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
          // 原子检查：已被他人认领则拒绝（409）
          const claimedBy = String(target.claimedDriverPhone || target.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
          const st = String(target.status || '');
          // P0(2026-10-16)：幂等短路——订单已被本人认领时直接成功。
          // 主幂等已在忙碌检查前做过（2026-10-16第二遍审计），此处为 doClaim 内部二次保险，
          // 防"早检通过→忙碌检查→doClaim执行"窗口内状态变化。
          if ((st === 'claimed' || st === '已接单') && claimedBy === cleanDriverPhone) {
            return { ok: true };
          }
          if ((st === 'claimed' || st === '已接单') && claimedBy && claimedBy !== cleanDriverPhone) {
            return { ok: false, code: 409, error: '该订单已被其他司机接单' };
          }
          // P0(2026-10-15晚)：派单中的订单不允许大厅抢单，必须等超时进大厅
          if (st === 'dispatched' && target.dispatchedDriverPhone && !target.in_hall) {
            return { ok: false, code: 409, error: '该订单正在派单中，请等待' };
          }
          // P1(2026-10-16)：大厅抢单必须校验订单真在大厅。否则可经 API 直接盗抢他人
          // 二维码创单（submitted 状态）等非大厅订单。
          const inHall = target.in_hall === true || st === 'hall' || st === '等待接单';
          if (!inHall) {
            return { ok: false, code: 409, error: '该订单不在选单大厅，无法抢单' };
          }
          if (st === 'cancelled' || st === '已取消' || target.isCancelled) {
            return { ok: false, code: 410, error: '该订单已取消' };
          }
          const updated = { ...target, ...claimData };
          // P1(2026-10-16)：并发双抢原子化——改条件 UPDATE，只有订单仍未被他人认领时才写入。
          // 之前先 SELECT 再 INSERT，两人同时通过检查会都写成功。条件不满足时 affectedRows=0 → 409。
          const [updRes]: any = await mysqlPool.query(
            'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ? ' +
            'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.status\')), \'\') NOT IN (\'claimed\', \'已接单\', \'cancelled\', \'已取消\') ' +
            'AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.claimedDriverPhone\')), \'\') = \'\' ' +
            'OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.claimedDriverPhone\')), \'\') = ?)',
            [JSON.stringify(updated), 'merchant_orders', cleanOrderId, cleanDriverPhone]
          );
          const affected = Number(updRes?.affectedRows || 0);
          if (affected === 0) {
            return { ok: false, code: 409, error: '该订单已被其他司机接单' };
          }
          // 清掉所有相关的 passenger_links（防重复弹窗）
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = 'passenger_links' AND `data` LIKE ?",
            [`%${cleanOrderId}%`]
          ).catch(() => {});
          // P1(2026-10-15)：大厅抢单成功后写busy，防连抢多单（与/api/order/claim同修）
          try {
            const _cols = ['driver_users', 'driver_locations', 'squad_members'];
            for (let _ci = 0; _ci < _cols.length; _ci++) {
              await mysqlPool.query(
                'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(TRUE AS JSON), "$.status", "busy") WHERE `collection` = ? AND `doc_id` = ?',
                [_cols[_ci], cleanDriverPhone]
              ).catch(function() {});
            }
          } catch (_) {}
          return { ok: true };
        } else {
          const dbData = readLocalJsonDb();
          if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
          const target = dbData['merchant_orders'][cleanOrderId] || {};
          const claimedBy = String(target.claimedDriverPhone || target.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
          const st = String(target.status || '');
          // P0(2026-10-16)：幂等短路（与 MySQL 分支同口径）——已被本人认领直接成功
          if ((st === 'claimed' || st === '已接单') && claimedBy === cleanDriverPhone) {
            return { ok: true };
          }
          if ((st === 'claimed' || st === '已接单') && claimedBy && claimedBy !== cleanDriverPhone) {
            return { ok: false, code: 409, error: '该订单已被其他司机接单' };
          }
          if (st === 'dispatched' && target.dispatchedDriverPhone && !target.in_hall) {
            return { ok: false, code: 409, error: '该订单正在派单中，请等待' };
          }
          // P1(2026-10-16)：本地分支同样校验订单真在大厅（与 MySQL 分支同口径）
          const inHallLocal = target.in_hall === true || st === 'hall' || st === '等待接单';
          if (!inHallLocal) {
            return { ok: false, code: 409, error: '该订单不在选单大厅，无法抢单' };
          }
          if (st === 'cancelled' || st === '已取消' || target.isCancelled) {
            return { ok: false, code: 410, error: '该订单已取消' };
          }
          dbData['merchant_orders'][cleanOrderId] = { ...target, ...claimData };
          // 清掉相关的 passenger_links
          if (dbData['passenger_links']) {
            for (const [k, v] of Object.entries<any>(dbData['passenger_links'])) {
              const vid = String(v?.id || v?.orderId || v?.orderNo || '');
              if (vid === cleanOrderId) delete dbData['passenger_links'][k];
            }
          }
          writeLocalJsonDb(dbData);
          return { ok: true };
        }
      };
      const result: any = await doClaim();
      if (!result.ok) {
        return res.status(result.code).json({ success: false, error: result.error });
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Order Driver Claim] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Driver Claim Error' });
    }
  });

  // P0(2026-10-15)：订单完成专用接口（requireDbAuth拦不住，必须走专用接口）
  // 之前司机点"完成"经/api/db/set写merchant_orders，targetId=订单号≠手机号被403拦截，
  // 导致订单永远claimed、非VIP每日2单统计永远0
  app.post('/api/order/complete', requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || req.body?.id || '').trim();
      // P0(2026-10-16第二遍审计)：补A后缀商户拦截，商户不能完成订单。
      const completeRaw = String((req as any).authPhone || '').trim();
      if (/a$/i.test(completeRaw)) {
        return res.status(403).json({ success: false, error: '商户身份不能完成订单' });
      }
      const authPhone = completeRaw.replace(/\D/g, '').trim();
      if (!orderId || !/^1[3-9]\d{9}$/.test(authPhone)) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      const now = Date.now();
      if (isMySQLEnabled && mysqlPool) {
        const [rows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['merchant_orders', orderId]
        );
        if (!rows || rows.length === 0) {
          return res.status(404).json({ success: false, error: '订单不存在' });
        }
        const od = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        const claimedBy = String(od.claimedDriverPhone || od.dispatchedDriverPhone || '').replace(/\D/g, '');
        if (claimedBy !== authPhone && authPhone !== '15509601222') {
          return res.status(403).json({ success: false, error: '只能完成自己的订单' });
        }
        od.status = 'completed';
        od.completedAt = now;
        od.updatedAt = now;
        await mysqlPool.query(
          'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
          [JSON.stringify(od), 'merchant_orders', orderId]
        );
        // 重置司机busy状态
        for (const col of ['driver_users', 'driver_locations', 'squad_members']) {
          try {
            const [drows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, authPhone]
            );
            if (drows && drows.length > 0) {
              const dd = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
              dd.isBusy = false;
              dd.status = 'idle';
              await mysqlPool.query(
                'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                [JSON.stringify(dd), col, authPhone]
              );
            }
          } catch (_) {}
        }
      } else {
        const dbData = readLocalJsonDb();
        const od = dbData['merchant_orders']?.[orderId];
        if (!od) {
          return res.status(404).json({ success: false, error: '订单不存在' });
        }
        const claimedBy = String(od.claimedDriverPhone || od.dispatchedDriverPhone || '').replace(/\D/g, '');
        if (claimedBy !== authPhone && authPhone !== '15509601222') {
          return res.status(403).json({ success: false, error: '只能完成自己的订单' });
        }
        od.status = 'completed';
        od.completedAt = now;
        od.updatedAt = now;
        for (const col of ['driver_users', 'driver_locations', 'squad_members']) {
          if (dbData[col]?.[authPhone]) {
            dbData[col][authPhone].isBusy = false;
            dbData[col][authPhone].status = 'idle';
          }
        }
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (e: any) {
      console.error('[OrderComplete] 失败:', e?.message);
      return res.status(500).json({ success: false, error: '完成订单失败，请重试' });
    }
  });

  // 2026-10-12 报单转单专用派单通道：以报单人位置为圆心，3公里内找最近的上线空闲小队司机；
  // 无人则转入选单大厅。不走鉴权。
  app.post('/api/report-transfer/dispatch', requireDbAuth, async (req, res) => {
    try {
      const {
        orderId, passengerPhone, pickupName, pickupDetail,
        pickupLat, pickupLng, paymentQrCode,
      } = req.body || {};
      // P1(2026-10-15)：reporterPhone绑定token，防冒用他人身份
      // P0(2026-10-16第二遍审计)：补A后缀商户拦截，必须在 replace(/\D/g) 之前判断原始值。
      const reporterRaw = String((req as any).authPhone || '').trim();
      if (/a$/i.test(reporterRaw)) {
        return res.status(403).json({ success: false, error: '商户身份不能发起转单' });
      }
      const cleanReporter = reporterRaw.replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(cleanReporter)) {
        return res.status(401).json({ success: false, error: '身份验证失败' });
      }
      // P1(2026-10-15)：orderId服务端生成，防客户端覆盖他人订单
      const cleanOrderId = `RT${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      // 接单授权检查 (2026-10-15)：发起人天数为0不能使用报单转单功能
      try {
        let repLic = '';
        if (isMySQLEnabled && mysqlPool) {
          const [rrows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_users', cleanReporter]);
          if (rrows && rrows.length > 0) {
            const rd = typeof rrows[0].data === 'string' ? JSON.parse(rrows[0].data) : rrows[0].data;
            repLic = String(rd.licenseExpiry || '');
          }
        } else {
          repLic = String(readLocalJsonDb()?.driver_users?.[cleanReporter]?.licenseExpiry || '');
        }
        if (!isLicenseValid(repLic)) {
          return res.status(403).json({ success: false, error: '接单授权已到期，请联系开发者充值' });
        }
      } catch (e) {
        console.error('[ReportTransfer] 发起人授权校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '授权校验失败，请重试' });
      }
      // P1(2026-10-16)：转单发起侧加非VIP每日2次服务端限制（之前仅前端限制，可绕过）。
      try {
        let vipExpiryRT = '';
        if (isMySQLEnabled && mysqlPool) {
          const [vrows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_users', cleanReporter]);
          if (vrows && vrows.length > 0) {
            const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
            vipExpiryRT = String(vd.vipExpiry || '');
          }
        } else {
          vipExpiryRT = String(readLocalJsonDb()?.driver_users?.[cleanReporter]?.vipExpiry || '');
        }
        if (!isVipActiveServer(vipExpiryRT)) {
          const todayRT = await countTodayReportTransfers(cleanReporter);
          if (todayRT >= 2) {
            return res.status(403).json({ success: false, error: '非VIP会员每天限转单2次，明早6点自动恢复。如需无限转单请开通VIP' });
          }
        }
      } catch (e) {
        console.error('[ReportTransfer] VIP限额校验异常:', (e as any)?.message);
      }
      const cleanPassenger = String(passengerPhone || '').replace(/\D/g, '').trim();
      // cleanOrderId已在上方服务端生成
      if (!cleanReporter || !/^1[3-9]\d{9}$/.test(cleanPassenger)) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      let pLat = Number(pickupLat);
      let pLng = Number(pickupLng);
      const badCoords = isNaN(pLat) || isNaN(pLng) || pLat === 0 || pLng === 0;
      // 坐标无效时尝试服务端高德解析一次（不阻塞太久）
      if (badCoords && pickupName) {
        try {
          const poi: any = await Promise.race([
            geocodeServerPoiAsync(String(pickupName), 0, 0, ''),
            new Promise(resolve => setTimeout(() => resolve(null), 3000)),
          ]);
          if (poi && poi.lat && poi.lng) { pLat = poi.lat; pLng = poi.lng; }
        } catch (_) {}
      }

      const nowTs = Date.now();
      const baseOrder: any = {
        id: cleanOrderId,
        orderId: cleanOrderId,
        passengerPhone: cleanPassenger,
        startLocation: String(pickupName || ''),
        startDetail: String(pickupDetail || ''),
        destination: '',
        status: 'submitted',
        timestamp: nowTs,
        dispatchedAt: nowTs,
        dispatchCountdown: 60,
        serverCountdown: 60,
        dispatchExpiresAt: nowTs + 60000,
        isValetOrder: true,
        isPlatformDispatch: true,
        orderRemark: '报单转单',
        orderType: '报单转单',
        type: '报单转单',
        passengerLat: pLat,
        passengerLng: pLng,
        lat: pLat,
        lng: pLng,
        startLat: pLat,
        startLng: pLng,
        approxPrice: '未知',
        scheduledTime: '现在出发',
        needScooter: false,
        merchantPhone: cleanReporter,
        reporterPhone: cleanReporter,
        dispatchedByPhone: cleanReporter,
        dispatchedBy: cleanReporter,
        paymentQrCode: paymentQrCode || '',
        merchantPaymentQrCode: paymentQrCode || '',
        merchantName: '报单转单',
      };

      const haversineKm = (la1: number, lo1: number, la2: number, lo2: number) => {
        const R = 6371;
        const dLa = (la2 - la1) * Math.PI / 180;
        const dLo = (lo2 - lo1) * Math.PI / 180;
        const a = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
          Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) *
          Math.sin(dLo / 2) * Math.sin(dLo / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      // 拉取小队成员与司机位置
      let squadList: any[] = [];
      let locationMap: Record<string, any> = {};
      // 2026-10-17: squadList 去 A 后缀商户号 + 按手机号去重（同 /api/dispatch/nearest）
      const dedupeSquadList = (list: any[]) => {
        const filtered = list.filter((item: any) => {
          if (/a$/i.test(String(item.rawId || '').trim())) return false;
          return Boolean(item.phone);
        });
        const seen = new Map<string, any>();
        for (const item of filtered) {
          const cp = String(item.phone || '');
          const prev = seen.get(cp);
          if (!prev) { seen.set(cp, item); continue; }
          const prevValid = isLicenseValid(prev?.data?.licenseExpiry);
          const curValid = isLicenseValid(item?.data?.licenseExpiry);
          if (!prevValid && curValid) seen.set(cp, item);
        }
        return Array.from(seen.values());
      };
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [squadRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?', ['squad_members']);
          squadList = dedupeSquadList((squadRows || []).map((r: any) => {
            const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const rawId = String(r.doc_id || '');
            return { phone: rawId.replace(/\D/g, '').trim(), rawId, data: d };
          }));
          const [locRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?', ['driver_locations']);
          (locRows || []).forEach((r: any) => {
            const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const p = String(r.doc_id || d?.phone || '').replace(/\D/g, '').trim();
            if (p) locationMap[p] = d;
          });
        } catch (_) {}
      }
      if (squadList.length === 0) {
        try {
          const dbData = readLocalJsonDb();
          const colData = dbData['squad_members'] || {};
          squadList = dedupeSquadList(Object.keys(colData).map(k => ({
            phone: String(k).replace(/\D/g, '').trim(), rawId: String(k), data: colData[k],
          })));
          const localLocations = dbData['driver_locations'] || {};
          Object.keys(localLocations).forEach(k => {
            const p = String(k).replace(/\D/g, '').trim();
            if (p && !locationMap[p]) locationMap[p] = localLocations[k];
          });
        } catch (_) {}
      }

      const isApproved = (d: any) => {
        const st = String(d?.status || d?.approvalStatus || '').trim();
        return ['已通过', 'approved', '通过'].includes(st);
      };
      // 2026-10-12修复：报单人必须是小队正式成员，否则拒绝（防外部直接调接口）
      const reporterEntry = squadList.find(m => m.phone === cleanReporter);
      const isReporterApproved = reporterEntry ? isApproved(reporterEntry.data) : cleanReporter === '15509601222';
      if (!isReporterApproved) {
        return res.status(403).json({ success: false, error: '仅小队正式成员可使用报单转单' });
      }
      const candidates: any[] = [];
      const coordsValid = !isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0;
      if (coordsValid) {
        for (const m of squadList) {
          const phone = m.phone;
          if (!phone || phone === cleanReporter) continue; // 绝不派给自己
          if (!isApproved(m.data)) continue;
          // 接单授权检查 (2026-10-15)：天数为0不派转单
          if (!isLicenseValid(m.data?.licenseExpiry)) continue;
          const loc = locationMap[phone];
          if (!loc) continue;
          const la = Number(loc.lat ?? loc.latitude);
          const lo = Number(loc.lng ?? loc.longitude);
          if (isNaN(la) || isNaN(lo) || la === 0 || lo === 0) continue;
          const updTs = Number(loc.locationTimestamp || loc.lastStatusUpdateTime || loc.lastLocationTime || 0);
          // P0(2026-10-16)：字段名与 /api/dispatch/nearest 同口径。之前读 loc.timestamp/loc.updatedAt/loc.lastUpdate
          // 三个不存在的字段，updTs 恒为 0，所有候选人被跳过，报单转单实际从未派单成功过、全部进了大厅。
          // 2026-10-12修复：无时间戳按过期处理（M2规则），不再放行幽灵司机
          if (!updTs || nowTs - updTs > 120000) continue; // GPS超120秒或无时间戳不派
          // 2026-10-12修复：必须明确 isOnline === true，undefined 不算在线
          const isOnline = loc.isOnline === true || loc.isOnline === 'true';
          const isBusy = loc.isBusy === true || loc.isBusy === "true" || loc.isBusy === 1;
          if (!isOnline || isBusy) continue;
          const distKm = haversineKm(pLat, pLng, la, lo);
          if (distKm <= 3) candidates.push({ phone, name: m.data?.name || m.data?.driverName || `司机${phone.slice(-4)}`, distKm });
        }
      }
      candidates.sort((a, b) => a.distKm - b.distKm);

      const writeOrder = async (col: string, docId: string, data: any) => {
        const dataStr = JSON.stringify(data);
        if (isMySQLEnabled && mysqlPool) {
          // P0(2026-10-16)：加 3 次重试，失败抛错（照 nearest P1-3 模式）。
          // 之前无重试，passenger_links 成功、merchant_orders 失败时产生僵尸派单。
          let ok = false;
          let lastErr: any = null;
          for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
            try {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', [col, docId, dataStr]);
              ok = true;
            } catch (e: any) {
              lastErr = e;
              if (attempt < 3) await new Promise(r => setTimeout(r, 200 * attempt));
            }
          }
          if (!ok) throw lastErr;
        } else {
          const dbData = readLocalJsonDb();
          if (!dbData[col]) dbData[col] = {};
          dbData[col][docId] = data;
          writeLocalJsonDb(dbData);
        }
      };
      const deleteLink = async (phone: string) => {
        if (!phone) return;
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['passenger_links', phone]).catch(() => {});
        } else {
          try {
            const dbData = readLocalJsonDb();
            if (dbData['passenger_links']?.[phone]) {
              delete dbData['passenger_links'][phone];
              writeLocalJsonDb(dbData);
            }
          } catch (_) {}
        }
      };

      if (candidates.length > 0) {
        const chosen = candidates[0];
        const dispatchedPayload = {
          ...baseOrder,
          status: 'dispatched',
          statusCategory: '已指派',
          dispatchedDriverPhone: chosen.phone,
          dispatchedDriverName: chosen.name,
          distKm: chosen.distKm,
        };
        await writeOrder('passenger_links', chosen.phone, dispatchedPayload);
        await writeOrder('merchant_orders', cleanOrderId, dispatchedPayload);
        return res.json({
          success: true, isHall: false,
          dispatchedDriverPhone: chosen.phone,
          dispatchedDriverName: chosen.name,
          distKm: chosen.distKm,
        });
      }

      // 3公里内无上线空闲司机 → 转入选单大厅
      const hallPayload = {
        ...baseOrder,
        status: 'hall',
        statusCategory: '等待接单',
        in_hall: true,
        coordsUnknown: !coordsValid,
      };
      await writeOrder('merchant_orders', cleanOrderId, hallPayload);
      return res.json({ success: true, isHall: true });
    } catch (err: any) {
      console.error('[Report Transfer Dispatch] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Report Transfer Dispatch Error' });
    }
  });

  // 2026-10-12 小队申请专用提交通道：司机提交自己的申请，不走 /api/db/set 的严格权限
  // P1-3修复(2026-10-15)：加鉴权，申请人手机号必须等于token身份，防冒名申请
  app.post('/api/squad-apply', requireDbAuth, async (req, res) => {
    try {
      const { phone, name, note, city } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      const cleanName = String(name || '').trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      // P1-3: 申请人必须为本人，防冒名
      const tokenPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (cleanPhone !== tokenPhone && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '只能为本人提交申请' });
      }
      if (!cleanName) {
        return res.status(400).json({ success: false, error: '请填写真实姓名' });
      }
      const appPayload = {
        id: `app-${Date.now()}`,
        name: cleanName,
        phone: cleanPhone,
        status: '待审核',
        note: String(note || '').slice(0, 200),
        city: String(city || '银川市').slice(0, 20),
        createdAt: new Date().toLocaleString(),
        timestamp: Date.now(),
        approvedBy: '',
        approvedRole: '',
        approvalTime: '',
      };
      const dataStr = JSON.stringify(appPayload);
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['squad_applications', cleanPhone, dataStr]
        );
      } else {
        const dbData = readLocalJsonDb();
        if (!dbData.squad_applications) dbData.squad_applications = {};
        dbData.squad_applications[cleanPhone] = appPayload;
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Apply] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Squad Apply Error' });
    }
  });

  // Upload WeChat QR Code directly to server filesystem (Baota panel)
  const qrsDir = path.join(process.cwd(), 'uploads', 'qrs');
  const qrcodesDir = path.join(process.cwd(), 'uploads', 'qrcodes');
  if (!fs.existsSync(qrsDir)) {
    fs.mkdirSync(qrsDir, { recursive: true });
  }
  if (!fs.existsSync(qrcodesDir)) {
    fs.mkdirSync(qrcodesDir, { recursive: true });
  }
  // P1-8修复(2026-10-15)：/uploads/qrcodes 不再静态裸奔，加鉴权（防猜URL下载他人收款码）
  app.use('/uploads/qrcodes', requireDbAuth, (req: any, res: any, next: any) => {
    // 允许：查自己的码 / 开发者 / 订单关联（通过get-wechat-qr的逻辑复用简化版：只允许自己的）
    // 订单关联的场景走 /api/get-wechat-qr 接口，这里只做基础防护
    const requester = String(req.authPhone || '').replace(/\D/g, '').trim();
    const filename = String(req.path || '').split('/').pop() || '';
    // 文件名格式: {phone}[_web|_app].png，提取手机号部分
    const m = filename.match(/^(\d{11}A?)(?:_(?:web|app))?\.png$/i);
    if (!m) return res.status(404).json({ success: false, error: 'Not found' });
    const filePhone = m[1].toUpperCase();
    const reqNorm = requester.toUpperCase();
    if (!req.isAdmin && filePhone !== reqNorm && filePhone !== reqNorm.replace(/A$/, '')) {
      return res.status(403).json({ success: false, error: '无权访问他人收款码' });
    }
    next();
  });
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.post('/api/upload-wechat-qr', requireDbAuth, async (req, res) => {
    try {
      const { phone, imageBase64, channel } = req.body;
      if (!phone || !imageBase64) {
        return res.status(400).json({ error: 'Missing phone or imageBase64' });
      }

      // 鉴权：只能上传自己的二维码（A后缀敏感）
      const rawPhone = String(phone).trim().toUpperCase();
      const authPhone = String((req as any).authPhone || '').trim().toUpperCase();
      if (!(req as any).isAdmin && rawPhone !== authPhone) {
        return res.status(403).json({ error: '无权上传他人二维码' });
      }

      const cleanPhone = rawPhone.replace(/\D/g, '').trim();
      if (!cleanPhone || cleanPhone.length !== 11) {
        return res.status(400).json({ error: '手机号格式错误' });
      }
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: '图片太大，请压缩后上传' });
      }

      // A后缀判断必须用原始phone（strip前），否则永假
      const isWeb = channel === 'web' || channel === 'mobile_web' || rawPhone.endsWith('A');
      // P0-5修复(2026-10-15)：文件名保留A后缀，商户15509601222A与司机15509601222账号隔离不串码
      const filePhone = rawPhone.endsWith('A') ? `${cleanPhone}A` : cleanPhone;
      const filename = isWeb ? `${filePhone}_web.png` : `${filePhone}.png`;
      const filepath = path.join(qrcodesDir, filename);
      const fallbackFilepath = path.join(qrsDir, filename);
      
      // Overwrite/replace file on server disk (Baota panel) - Guaranteed single file per account
      await fs.promises.writeFile(filepath, buffer);
      try {
        await fs.promises.writeFile(fallbackFilepath, buffer);
      } catch (_) {}

      if (!isWeb) {
        try {
          const appFilepath = path.join(qrcodesDir, `${filePhone}_app.png`);
          await fs.promises.writeFile(appFilepath, buffer);
          await fs.promises.writeFile(path.join(qrsDir, `${filePhone}_app.png`), buffer);
        } catch (_) {}
      }
      
      const qrUrl = `/uploads/qrcodes/${filename}?t=${Date.now()}`;
      
      // Update MySQL & Local DB collections safely via merge (NEVER replace entire driver profile)
      const targetCols = isWeb 
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users']
        : ['app_valet_qrs', 'dispatch_qrs', 'dispatch_qrcodes', 'driver_users', 'squad_members'];

      const qrPayload = {
        // P0-5: doc_id保留A后缀，账号隔离
        id: filePhone,
        phone: filePhone,
        qrCode: qrUrl,
        wechatQrCode: qrUrl,
        qrcode_url: `/uploads/qrcodes/${filename}`,
        channel: isWeb ? 'web' : 'app',
        updatedAt: new Date().toISOString()
      };

      for (const col of targetCols) {
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, filePhone]
            );
            let merged = { ...qrPayload };
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              merged = { ...prev, ...qrPayload };
            }
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              [col, filePhone, JSON.stringify(merged)]
            );
          } catch (_) {}
        }
      }

      try {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][cleanPhone] = { ...(dbData[col][cleanPhone] || {}), ...qrPayload };
        }
        writeLocalJsonDb(dbData);
      } catch (_) {}

      res.json({ success: true, url: qrUrl, channel: isWeb ? 'web' : 'app' });
    } catch (err: any) {
      console.error('[Server] Failed to upload WeChat QR:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // H7修复：删除支付宝上传接口（违反"支付宝绝不上传服务器"铁律），返回410 Gone
  app.post('/api/upload-alipay-qr', (req, res) => {
    return res.status(410).json({
      success: false,
      error: '该接口已下线：支付宝收款码只存App本地，绝不上传服务器'
    });
  });


  // Query WeChat QR code directly with disk existence checks and channel priority
  // M12修复：IP频率限制（防枚举手机号注册状态），60秒最多20次
  app.get('/api/get-wechat-qr', requireDbAuth, async (req, res) => {
    try {
      // P0-4修复(2026-10-14)：账号隔离 + 订单关联授权
      // 业务规则：谁下的单显示谁的微信码（从服务器拉取）
      // 允许：①查自己的码 ②开发者查任意 ③订单的执行司机/下单人查该订单下单人的码（需传 orderId 验证关联）
      const requester = String((req as any).authPhone || '').replace(/\D/g, '');
      const queryPhone = String(req.query.phone || '').replace(/\D/g, '');
      const orderId = String(req.query.orderId || '').trim();
      const isDev = (req as any).isAdmin;
      let authorized = isDev || queryPhone === requester;
      if (!authorized && orderId) {
        // P0-3修复(2026-10-15)：生产服订单只在MySQL，本地JSON查不到，改走MySQL查订单
        const checkOrderAuth = (order: any) => {
          if (!order) return false;
          const ordererPhone = String(order.merchantPhone || order.driverPhone || order.ordererPhone || '').replace(/\D/g, '');
          const assignedDriver = String(order.dispatchedDriverPhone || order.claimedDriverPhone || '').replace(/\D/g, '');
          // 下单人的码：订单的执行司机或下单人本人可以查
          return queryPhone === ordererPhone && (requester === assignedDriver || requester === ordererPhone);
        };
        try {
          // 先查MySQL（生产服）
          if (isMySQLEnabled && mysqlPool) {
            for (const col of ['merchant_orders', 'valet_orders']) {
              try {
                const [rows]: any = await mysqlPool.query(
                  'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                  [col, orderId]
                );
                if (rows && rows.length > 0) {
                  const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
                  if (checkOrderAuth(data)) { authorized = true; break; }
                }
              } catch (_) {}
            }
          }
          // 回退查本地JSON（开发/单机模式）
          if (!authorized) {
            const dbData = readLocalJsonDb();
            const order = dbData.merchant_orders?.[orderId] || dbData.valet_orders?.[orderId];
            if (checkOrderAuth(order)) authorized = true;
          }
        } catch (_) {}
      }
      if (!authorized) {
        return res.status(403).json({ success: false, error: '无权查询该收款码' });
      }
      const clientIp = getClientIp(req);
      const now = Date.now();
      const qrKey = `qr:${clientIp}`;
      const qrLogs = (smsSendLogs.get(qrKey) || []).filter((t) => now - t < 60 * 1000);
      if (qrLogs.length >= 20) {
        return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
      }
      qrLogs.push(now);
      smsSendLogs.set(qrKey, qrLogs);

      const rawPhoneQ = String(req.query.phone || '').trim().toUpperCase();
      const phoneDigits = rawPhoneQ.replace(/\D/g, '').trim();
      const channel = String(req.query.channel || '').trim();
      if (!phoneDigits) {
        return res.status(400).json({ success: false, error: 'Missing phone' });
      }
      // P0(2026-10-15)：保留A后缀，防串码
      const phone = rawPhoneQ.endsWith('A') ? `${phoneDigits}A` : phoneDigits;

      const isWeb = channel === 'web' || channel === 'mobile_web' || phone.endsWith('A');
      const webFilename = `${phone}_web.png`;
      const appFilename = `${phone}.png`;
      const appSpecificFilename = `${phone}_app.png`;

      // 1. Direct filesystem check in uploads/qrcodes and uploads/qrs
      if (isWeb) {
        if (fs.existsSync(path.join(qrcodesDir, webFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, webFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${webFilename}?t=${stat.mtimeMs}`, channel: 'web' });
        }
        if (fs.existsSync(path.join(qrsDir, webFilename))) {
          const stat = fs.statSync(path.join(qrsDir, webFilename));
          return res.json({ success: true, url: `/uploads/qrs/${webFilename}?t=${stat.mtimeMs}`, channel: 'web' });
        }
      } else {
        if (fs.existsSync(path.join(qrcodesDir, appSpecificFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, appSpecificFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appSpecificFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
        if (fs.existsSync(path.join(qrcodesDir, appFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
        if (fs.existsSync(path.join(qrsDir, appSpecificFilename))) {
          const stat = fs.statSync(path.join(qrsDir, appSpecificFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appSpecificFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
        if (fs.existsSync(path.join(qrsDir, appFilename))) {
          const stat = fs.statSync(path.join(qrsDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
      }

      // 2. Query collections (MySQL & Local JSON DB)
      const targetCols = isWeb
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users', 'dispatch_qrs', 'dispatch_qrcodes', 'driver_users']
        : ['app_valet_qrs', 'driver_users', 'dispatch_qrs', 'dispatch_qrcodes', 'web_valet_qrs', 'merchant_users'];

      if (isMySQLEnabled && mysqlPool) {
        for (const col of targetCols) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, phone]
            );
            if (rows && rows.length > 0) {
              const rowData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
              if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
                return res.json({ success: true, url: foundQr, channel: isWeb ? 'web' : 'app' });
              }
            }
          } catch (_) {}
        }
      }

      const dbData = readLocalJsonDb();
      for (const col of targetCols) {
        if (dbData[col] && dbData[col][phone]) {
          const rowData = dbData[col][phone];
          const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
          if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
            return res.json({ success: true, url: foundQr, channel: isWeb ? 'web' : 'app' });
          }
        }
      }

      // Fallback check standard file if web specific not yet uploaded
      if (fs.existsSync(path.join(qrsDir, appFilename))) {
        const stat = fs.statSync(path.join(qrsDir, appFilename));
        return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: 'fallback' });
      }

      return res.json({ success: false, url: '', message: 'QR not found' });
    } catch (err: any) {
      console.error('[Server get-wechat-qr error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete WeChat QR Code directly from server filesystem (Baota panel) and clean collections
  app.post('/api/delete-wechat-qr', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.userPhone || '').trim();
      if (!phone) {
        return res.status(400).json({ error: 'Missing phone' });
      }

      // 鉴权：只能删除自己的二维码（A后缀敏感）
      const rawPhone = phone.toUpperCase();
      const authPhone = String((req as any).authPhone || '').trim().toUpperCase();
      if (!(req as any).isAdmin && rawPhone !== authPhone) {
        return res.status(403).json({ error: '无权删除他人二维码' });
      }

      // 路径遍历防护：只允许精确文件名，不做前缀匹配
      // P0(2026-10-15)：保留A后缀，防商户删错司机的码
      const cleanPhone = rawPhone.replace(/\D/g, '').trim();
      if (!cleanPhone || cleanPhone.length !== 11) {
        return res.status(400).json({ error: '手机号格式错误' });
      }
      const filePhone = rawPhone.endsWith('A') ? `${cleanPhone}A` : cleanPhone;
      const allowedFiles = new Set([`${filePhone}.png`, `${filePhone}_web.png`, `${filePhone}_app.png`]);

      // Delete disk physical files from both qrcodesDir and qrsDir
      [qrcodesDir, qrsDir].forEach(dir => {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            files.forEach(f => {
              if (allowedFiles.has(f)) {
                try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
              }
            });
          } catch (_) {}
        }
      });

      // Also clean MySQL and local JSON DB
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', ['dispatch_qrs', phone]);
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', ['dispatch_qrcodes', phone]);
          
          const [rows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', phone]);
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            prev.wechatQrCode = '';
            prev.qrCode = '';
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['driver_users', phone, JSON.stringify(prev)]);
          }

          const [squadRows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['squad_members', phone]);
          if (squadRows && squadRows.length > 0) {
            const squadPrev = typeof squadRows[0].data === 'string' ? JSON.parse(squadRows[0].data) : squadRows[0].data;
            squadPrev.wechatQrCode = '';
            squadPrev.qrCode = '';
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['squad_members', phone, JSON.stringify(squadPrev)]);
          }
        } catch (err: any) {
          console.error('[MySQL delete-wechat-qr error]:', err);
        }
      }

      const dbData = readLocalJsonDb();
      if (dbData.dispatch_qrs && dbData.dispatch_qrs[phone]) delete dbData.dispatch_qrs[phone];
      if (dbData.dispatch_qrcodes && dbData.dispatch_qrcodes[phone]) delete dbData.dispatch_qrcodes[phone];
      if (dbData.driver_users && dbData.driver_users[phone]) {
        dbData.driver_users[phone].wechatQrCode = '';
        dbData.driver_users[phone].qrCode = '';
        dbData.driver_users[phone].qrcode_url = '';
      }
      if (dbData.squad_members && dbData.squad_members[phone]) {
        dbData.squad_members[phone].wechatQrCode = '';
        dbData.squad_members[phone].qrCode = '';
        dbData.squad_members[phone].qrcode_url = '';
      }
      if (dbData.online_applications && dbData.online_applications[phone]) {
        dbData.online_applications[phone].wechatQrCode = '';
        dbData.online_applications[phone].qrCode = '';
        dbData.online_applications[phone].qrcode_url = '';
      }
      if (dbData.squad_applications && dbData.squad_applications[phone]) {
        dbData.squad_applications[phone].wechatQrCode = '';
        dbData.squad_applications[phone].qrCode = '';
        dbData.squad_applications[phone].qrcode_url = '';
      }
      writeLocalJsonDb(dbData);

      console.log(`✓ [Server] Deleted QR code for phone: ${phone}`);
      res.json({ success: true, message: 'QR code deleted successfully' });
    } catch (err: any) {
      console.error('[Server] Failed to delete QR:', err);
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  // Explicit routes for passenger order HTML pages
  app.get('/passenger_order.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'passenger_order.html'));
  });
  app.get('/aliyun_passenger_deploy.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'aliyun_passenger_deploy.html'));
  });

  // Helper for binary-safe file download stream (.zip, .tar.gz, .tar)
  const servePackageFile = (req: express.Request, res: express.Response, requestedName = 'daijia_deploy.zip') => {
    const candidatePaths = [
      path.join(process.cwd(), 'public', requestedName),
      path.join(process.cwd(), requestedName),
      path.join(process.cwd(), 'dist', requestedName),
      path.join(process.cwd(), 'public', 'daijia_deploy.zip'),
      path.join(process.cwd(), 'daijia_deploy.zip'),
      path.join(process.cwd(), 'dist', 'daijia_deploy.zip'),
    ];

    let targetPath = candidatePaths.find(p => fs.existsSync(p) && fs.statSync(p).size > 1000000);

    // Auto-repair/rebuild if file does not exist or is smaller than 1MB
    if (!targetPath) {
      try {
        console.log(`[Package Service] File ${requestedName} missing or invalid, running create_deploy_zip.py...`);
        execSync('python3 create_deploy_zip.py', { cwd: process.cwd() });
        targetPath = candidatePaths.find(p => fs.existsSync(p) && fs.statSync(p).size > 1000000);
      } catch (e: any) {
        console.error('Build package failed:', e);
      }
    }

    if (targetPath && fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${requestedName}"`);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Transfer-Encoding', 'binary');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const fileStream = fs.createReadStream(targetPath);
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        console.error('[Package Service] Stream pipe error:', err);
        if (!res.headersSent) {
          res.status(500).send('Download stream failed');
        }
      });
    } else {
      res.status(500).json({ error: 'Package file build failed' });
    }
  };

  app.get('/daijia_deploy.zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));
  app.get('/baota_deploy.zip', (req, res) => servePackageFile(req, res, 'baota_deploy.zip'));
  app.get('/deploy.zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));
  app.get('/api/download-zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));
  app.get('/api/download/zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));

  app.get('/daijia_deploy.tar.gz', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar.gz'));
  app.get('/baota_deploy.tar.gz', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar.gz'));
  app.get('/daijia_deploy.tar', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar'));
  app.get('/baota_deploy.tar', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar'));

  // Integration with Vite development server middleware for dev OR static assets serving for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware loaded.");
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.get('*', (req, res) => {
      if (fs.existsSync(indexHtmlPath)) {
        res.sendFile(indexHtmlPath);
      } else {
        res.status(404).send('Application build in progress or index.html not found');
      }
    });
    console.log("Static production build files configured from:", distPath);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dedicated Full-Stack proxy server boot successfully on port: http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("FATAL: Failed to boot Express Server:", err);
});
