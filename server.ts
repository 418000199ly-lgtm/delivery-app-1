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
const smsVerifyIpLogs = new Map<string, number[]>(); // 2026-10-23 第二十六轮：/api/sms/verify 的 IP 维度尝试记录（防爆破）

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

// 2026-10-21 第三轮：无状态 v1 HMAC token 基础设施已整体下线（签发早停、验签密钥曾泄露、无吊销手段）。
// 现行凭证只有 st_ 持久 token（MySQL/JSON auth_tokens）与登录内存 Map 两路，见 requireDbAuth。

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
// 2026-10-24 第四十二轮续修4：race 只让调用方脱身，底层查询仍在 MySQL 里跑完
// （僵尸查询持续占连接与 CPU）。改走 mysql2 的 options.timeout——超时后驱动会
// 销毁该连接、服务端查询随连接断开真正终止；外层 race 保留作双保险。
function mysqlQueryTimeout<T>(pool: any, sql: string, params: any[], ms: number, label: string): Promise<T> {
  return Promise.race([
    pool.query({ sql, timeout: ms }, params),
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
  // 2026-10-22 第六轮：别名集合并——与 getLicenseDaysRemaining 一致，四别名全认
  if (s === '永久有效' || s === '永久' || s === '终身' || s === 'permanent') return true;
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
// 北京时间业务日日期字符串（2026-10-15 P0：非VIP每日2单用）
// 2026-10-24 第四十九轮口径修复：用户铁律为「每天凌晨6点自动刷新」，403 文案也承诺
// 「明早6点自动恢复」，但原实现按自然日 00:00 切分——司机 23:30 用完 2 次、00:00 即恢复，
// 一个业务夜可白嫖 4 次，与承诺不符。改为业务日锚点：北京时间减 6 小时后取日期
// （00:00–05:59 仍属前一业务日）。本函数与下方 beijingDayStrOf 仅供两个限额计数器使用，
// 改动面仅限非VIP限额口径，不影响任何展示统计。
function getBeijingTodayStr(): string {
  return beijingDayStrOf(Date.now());
}
function beijingDayStrOf(tsMs: number): string {
  return new Date(Number(tsMs) + 8 * 60 * 60 * 1000 - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
          const bjt = beijingDayStrOf(Number(ts));
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
        const bjt = beijingDayStrOf(Number(ts));
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
          const bjt = beijingDayStrOf(Number(ts));
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
        const bjt = beijingDayStrOf(Number(ts));
        if (bjt === todayStr) count++;
      }
    }
  } catch (e) {
    console.error('[CountRT] 统计失败:', (e as any)?.message);
  }
  return count;
}
// 2026-10-18 有状态鉴权（一号一token终身制，用户拍板）：
// MySQL auth_tokens 集合存 phone<->token 双向映射，token 为随机串，永久有效，
// 退出/重装/重登不换 token，密钥轮换不影响。doc_id 用 p:{phone} 和 t:{token} 前缀区分。
// 2026-10-22 第十一轮自愈：校验只认 t:{token} 反向记录，而发放只读 p:{phone} 正向记录。
// 历史上双写任一侧静默失败（.catch 吞错）或数据单独受损时，p: 在而 t: 缺——发放会把
// 永远校验不过的死 token 一次次发回，账号表现为「怎么登录都 401」且无自愈路径。
// 故发放既有 token 前先确保反向记录存在，缺失即按本次登录的 scope/身份补写（仅补缺、不覆盖）。
async function ensureTokenReverseRecord(cleanPhone: string, token: string, scope: string, isMerchant: boolean): Promise<void> {
  const tokenKey = `t:${token}`;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows]: any = await mysqlPool.query(
        'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
        ['auth_tokens', tokenKey]
      );
      if (rows && rows.length > 0) {
        // 2026-10-23 第十六轮：解析失败必须按「记录不存在」处理、落到下方 upsert 覆盖修复。
        // 旧写法 JSON.parse 抛错被外层 catch 吞掉，自愈静默中止——t 记录一旦损坏（半写/乱码），
        // 账号每次登录都领回死 token 且永不修复（harness C2 实测复现）。
        let d: any = null;
        try { d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data; } catch (_) { d = null; }
        if (d && d.phone) return;
      }
      const tokenData = JSON.stringify({ phone: cleanPhone, scope: String(scope || 'driver'), isMerchant: !!isMerchant, createdAt: new Date().toISOString(), healed: true });
      await mysqlPool.query(
        'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
        ['auth_tokens', tokenKey, tokenData]
      ).catch(() => {});
    } else {
      const dbData: any = readLocalJsonDb() || {};
      if (!dbData.auth_tokens) dbData.auth_tokens = {};
      const cur = dbData.auth_tokens[tokenKey];
      if (cur && (cur as any).phone) return;
      dbData.auth_tokens[tokenKey] = { phone: cleanPhone, scope: String(scope || 'driver'), isMerchant: !!isMerchant, createdAt: new Date().toISOString(), healed: true };
      writeLocalJsonDb(dbData);
    }
  } catch (_) {}
}

async function getOrCreatePersistentToken(phone: string, scope: string, isMerchant: boolean): Promise<string> {
  const cleanPhone = String(phone || '').trim();
  if (!cleanPhone) throw new Error('手机号为空');
  const phoneKey = `p:${cleanPhone}`;
  // 1. 查已绑定
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows]: any = await mysqlPool.query(
        'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
        ['auth_tokens', phoneKey]
      );
      if (rows && rows.length > 0) {
        const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        if (d && d.token) {
          const existingToken = String(d.token);
          await ensureTokenReverseRecord(cleanPhone, existingToken, scope, isMerchant);
          return existingToken;
        }
      }
    } else {
      const dbData: any = readLocalJsonDb() || {};
      const existing = dbData?.auth_tokens?.[phoneKey];
      if (existing && (existing as any).token) {
        const existingToken = String((existing as any).token);
        await ensureTokenReverseRecord(cleanPhone, existingToken, scope, isMerchant);
        return existingToken;
      }
    }
  } catch (_) {}
  // 2. 无绑定则生成（64位随机hex，不依赖HMAC密钥，轮换密钥不影响）
  const newToken = 'st_' + crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const tokenKey = `t:${newToken}`;
  const phoneData = JSON.stringify({ token: newToken, phone: cleanPhone, createdAt: now });
  const tokenData = JSON.stringify({ phone: cleanPhone, scope: String(scope || 'driver'), isMerchant: !!isMerchant, createdAt: now });
  try {
    if (isMySQLEnabled && mysqlPool) {
      await mysqlPool.query(
        'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
        ['auth_tokens', phoneKey, phoneData]
      ).catch(() => {});
      await mysqlPool.query(
        'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
        ['auth_tokens', tokenKey, tokenData]
      ).catch(() => {});
      // 2026-10-18修：防并发竞态。两请求同时登录都查无token、各生成一个时，
      // 回读 p:{phone} 看最终赢家；若不是自己，则删掉自己的孤儿 t:{token} 记录，返回赢家的 token。
      // 保证一号一 token，不产生孤儿。
      try {
        const [vrows]: any = await mysqlPool.query(
          'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
          ['auth_tokens', phoneKey]
        );
        if (vrows && vrows.length > 0) {
          const vd = typeof vrows[0].data === 'string' ? JSON.parse(vrows[0].data) : vrows[0].data;
          const winnerToken = vd && vd.token ? String(vd.token) : '';
          if (winnerToken && winnerToken !== newToken) {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['auth_tokens', tokenKey]
            ).catch(() => {});
            // 第十一轮自愈：赢家 token 的反向记录也确保存在（其写入可能曾静默失败）
            await ensureTokenReverseRecord(cleanPhone, winnerToken, scope, isMerchant);
            return winnerToken;
          }
        }
      } catch (_) {}
    } else {
      const dbData: any = readLocalJsonDb() || {};
      if (!dbData.auth_tokens) dbData.auth_tokens = {};
      // 本地 JSON 单进程无并发，此处直接覆盖即最终一致
      dbData.auth_tokens[phoneKey] = JSON.parse(phoneData);
      dbData.auth_tokens[tokenKey] = JSON.parse(tokenData);
      writeLocalJsonDb(dbData);
    }
  } catch (_) {}
  // 第十一轮自愈：新签发也兜底确保反向记录（MySQL 双写任一侧曾静默失败时不发死 token）
  await ensureTokenReverseRecord(cleanPhone, newToken, scope, isMerchant);
  return newToken;
}

// 校验有状态 token：查 MySQL auth_tokens（t:{token}），命中返回身份，否则 null
// 2026-10-24 第四十四轮：派单候选池缓存（3000 人规模化）。
// 旧实现每单全表组装三张表（squad_members + driver_locations + driver_users 的
// 全量 SELECT + 逐条 JSON.parse），3000 人时每单约 6000 次解析、且随人数线性涨。
// 改为：组装结果缓存 3 秒；MySQL 模式每次命中前先探 MAX(updated_at)（成员/档案
// 两表，单条聚合约 1ms）——探针变化立即重组，资格类变更（审批/踢人/充值/改角色）
// 近实时生效；位置图随缓存最多旧 3 秒（GPS 上报本身间隔 8-30 秒，无实际影响）。
// 下游过滤/诊断/排序逻辑与数据结构零改动，且已核查组装后无任何写回这三份结构。
let _dispatchPoolsCache: { at: number; stamp: string; squadList: any[]; locationMap: Record<string, any>; driverDocMap: Record<string, any> } | null = null;
const DISPATCH_POOL_TTL_MS = 3000;
async function dispatchPoolsStamp(): Promise<string> {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows]: any = await mysqlPool.query(
        "SELECT MAX(`updated_at`) AS m FROM `daijia_documents` WHERE `collection` IN ('squad_members','driver_users')"
      );
      return String(rows?.[0]?.m || '');
    } catch (_) { return ''; }
  }
  return '';
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
async function saveDispatchPoolsCache(pools: { squadList: any[]; locationMap: Record<string, any>; driverDocMap: Record<string, any> }) {
  const stamp = await dispatchPoolsStamp();
  _dispatchPoolsCache = { at: Date.now(), stamp, squadList: pools.squadList, locationMap: pools.locationMap, driverDocMap: pools.driverDocMap };
}

// 2026-10-24 第四十二轮：token 校验正向缓存。requireDbAuth 对每个 /api/db/* 请求都
// 调 verifyPersistentToken，旧实现在 MySQL 模式下每请求实查一次 auth_tokens 表+JSON
// 解析——请求风暴时这是 mysqld 的主要负载之一，且给每个请求叠加一次往返延迟。
// token 为终身制、绑定关系不变，成功结果缓存 60 秒是安全的；吊销走
// invalidatePersistentTokenCacheByPhone 在 /api/admin/revoke-token 处同步失效。
const _persistentTokenCache = new Map<string, { phone: string; scope: string; isMerchant: boolean; at: number }>();
const TOKEN_VERIFY_CACHE_TTL_MS = 60 * 1000;
function invalidatePersistentTokenCacheByPhone(phone: string) {
  const p = String(phone || '').trim();
  for (const [k, v] of Array.from(_persistentTokenCache.entries())) {
    if (v.phone === p) _persistentTokenCache.delete(k);
  }
}

async function verifyPersistentToken(token: string): Promise<{ phone: string; scope: string; isMerchant: boolean } | null> {
  const t = String(token || '').trim();
  if (!t || !t.startsWith('st_')) return null;
  const cachedHit = _persistentTokenCache.get(t);
  if (cachedHit && (Date.now() - cachedHit.at) < TOKEN_VERIFY_CACHE_TTL_MS) {
    return { phone: cachedHit.phone, scope: cachedHit.scope, isMerchant: cachedHit.isMerchant };
  }
  const tokenKey = `t:${t}`;
  try {
    if (isMySQLEnabled && mysqlPool) {
      const [rows]: any = await mysqlPool.query(
        'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
        ['auth_tokens', tokenKey]
      );
      if (rows && rows.length > 0) {
        const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        if (d && d.phone) {
          const out = { phone: String(d.phone), scope: String(d.scope || 'driver'), isMerchant: !!d.isMerchant };
          _persistentTokenCache.set(t, { ...out, at: Date.now() });
          return out;
        }
      }
    } else {
      const dbData: any = readLocalJsonDb() || {};
      const d = dbData?.auth_tokens?.[tokenKey];
      if (d && (d as any).phone) {
        const out = { phone: String((d as any).phone), scope: String((d as any).scope || 'driver'), isMerchant: !!(d as any).isMerchant };
        _persistentTokenCache.set(t, { ...out, at: Date.now() });
        return out;
      }
    }
  } catch (_) {}
  return null;
}

// 2026-10-24 根治「时间戳字段遮蔽」（生产实证）：定位/成员文档上有多个时间字段，
// 不同上报路径只刷新其中一部分——如 iPhone 当前上报路径只刷 locationTimestamp /
// lastUpdatedTime，lastLocationTime 会冻结在旧值（生产开发者文档冻结于当日 05:58:47，
// 仅比亚日 05:59 截止线早 13 秒）。凡新鲜度判定按「首个非空字段」取值者，都会被
// 陈旧字段遮蔽秒级新鲜的其它字段，把正在上报的司机误判过期/离线（/api/driver/
// locations 因此把开发者 isOnline 改成 false 回给普通成员，对方地图与小队列表
// 默认不显示离线者，于是「对方在线却看不到他」，而对方的新号文档无陈旧字段、
// 反向看一切正常，现象呈单向不对称）。统一口径：新鲜度 = 全部时间字段的最大值。
function latestTimeMs(...vals: any[]): number {
  let m = 0;
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const num = Number(v);
    const n = isNaN(num) ? new Date(v as any).getTime() : num;
    if (n > m) m = n;
  }
  return m;
}
function docLatestTimeMs(doc: any): number {
  if (!doc) return 0;
  return latestTimeMs(
    doc.onlineSessionTime, doc.lastLocationTime, doc.locationTimestamp,
    doc.timestamp, doc.lastStatusUpdateTime, doc.lastUpdatedTime, doc.updatedAt
  );
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
// 2026-10-21 第四轮：补第三个短信豁免号 18695119126（用户 2026-10-15 定版三号豁免，此前派单台 24 小时登录限制独漏此号）
const WHITELIST_PHONES = ['15509601222', '15121904440', '18695119126'];

// In-memory store for WeChat scan login sessions
// wechatSessions 已随微信扫码登录下线删除（2026-10-21 第三轮）

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
let _corruptQuarantineDone = false;

function readLocalJsonDb(): Record<string, Record<string, any>> {
  // H15修复：有未刷盘的脏数据时直接返回内存缓存，避免脏派单被磁盘旧快照覆盖丢失
  if (_dbDirty && cachedDbData) return cachedDbData;
  // 2026-10-24 第四十三轮根治（压测实证的整库回滚）：旧实现只要 _dbDirty=false 就
  // 每次从磁盘重解析并替换 cachedDbData——任何跨 await 持有旧引用的调用方（派单
  // 3 秒准备期是典型）写回时把快照之后的全库更新整批冲掉：1000 单压测中 42 单
  // 文档被邻单派单写回抹除、多次 claim 被冲掉致订单卡大厅。进程是本文件唯一
  // 写者（人工改文件按铁律先停 Node），故缓存一旦建立即以内存为唯一事实源，
  // 磁盘只在首次加载时读。单文档级读-改-写竞态仍在（业务层已有锁/状态机兜底），
  // 但整库级回滚就此消除；MySQL 模式同理受益（镜像与内存读不再被旧快照污染）。
  if (cachedDbData) return cachedDbData;
  try {
    if (fs.existsSync(LOCAL_JSON_DB_PATH)) {
      const content = fs.readFileSync(LOCAL_JSON_DB_PATH, 'utf8');
      cachedDbData = JSON.parse(content || '{}');
      lastDbReadTime = Date.now();
      return cachedDbData!;
    }
  } catch (e) {
    console.error('[Local JSON DB] Read error:', e);
    // 2026-10-23 第十四轮加固：镜像 JSON 损坏时把坏文件隔离备份一份再继续（空缓存启动），
    // 否则后续任意一次写入会用新数据 rename 覆盖坏文件，真数据（MySQL 故障时的唯一兜底）无声蒸发、不可恢复。
    if (!_corruptQuarantineDone) {
      _corruptQuarantineDone = true;
      try {
        const q = `${LOCAL_JSON_DB_PATH}.corrupt.${Date.now()}`;
        fs.copyFileSync(LOCAL_JSON_DB_PATH, q);
        console.error(`[Local JSON DB] 损坏文件已隔离备份: ${q}（请人工核查后恢复或清理）`);
      } catch (_) {}
    }
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
  // 2026-10-24 第四十二轮优化：MySQL 已启用时 immediate 也改走脏标异步刷盘。
  // 依据：MySQL 是唯一权威、内存缓存 cachedDbData 已在上方同步更新（进程内读一致性不受影响），
  // JSON 文件只是兜底镜像；原同步路径每次写操作都全量 JSON.stringify 整库+同步落盘
  // （实验室 2.7MB 库实测单个写操作约 110–150ms 全耗在此），随订单历史膨胀线性恶化，
  // 是高并发下事件循环被序列化堵死的主因。镜像新鲜度由 5 秒批量刷盘保证；启动时服务端
  // 以 MySQL 合并重建镜像，进程崩溃最多丢 5 秒镜像增量、不丢业务数据。
  // MySQL 未启用（JSON 即唯一存储）时维持同步写不变。
  if (immediate && !(isMySQLEnabled && mysqlPool)) {
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

// =====================================================================
// 2026-10-20 重建：统一成员状态机（唯一口径）
// 事实源：squad_members=唯一成员事实，squad_applications=唯一申请事实。
// 开发者 15509601222 恒为成员、豁免 removed 名单（接单授权不豁免）。
// =====================================================================
const APPROVED_MEMBER_STATUS_VALUES = ['已通过', 'approved', '通过'];
function normalizeDriverPhoneUnified(value: any): string {
  return String(value || '').replace(/\D/g, '').trim();
}
function parseStoredDoc(raw: any): any {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (_) { return null; } }
  return raw;
}
// 2026-10-23 第十八轮：严格布尔解析。Boolean('false')===true 的经典坑——客户端/表单
// 以字符串传 isOnline/isBusy/isReporting/gpsValid 时，'false' 会被误读成 true（假上线、
// 假忙碌、占用误判、gpsValid 守卫失效）。统一口径：true/1/'true'/'1' 为真，
// false/0/'false'/'0' 为假，其余（含 undefined）返回 undefined 表示未提供。
function parseStrictBool(value: any): boolean | undefined {
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  return undefined;
}
// 2026-10-23 第十九轮：商户 A 后缀身份守卫。多个管理接口先 replace(/\D/g) 再校验，
// '13900000102A' 会被静默剥成纯数字司机号——给商户充授权/改VIP/改名实际打到同号
// 司机身上（实测串号充值成功）。凡目标手机号原始形态以 A 结尾，一律拒绝执行。
function hasMerchantASuffix(raw: any): boolean {
  return /a$/i.test(String(raw ?? '').trim());
}
function isApprovedMemberStatus(value: any): boolean {
  return APPROVED_MEMBER_STATUS_VALUES.includes(String(value || '').trim());
}
// 2026-10-23 第二十三轮：成员状态有效值。在线态值（idle/busy/offline/online）是「在场域」
// 的值、不是「成员资格域」的事实——历史上多条服务端路径曾把它们写进 squad_members.status
// （2026-10-20/21 已逐条堵源），但存量毒化文档不会自愈：2026-10-23 生产实证，开发者成员
// 文档 status='idle'（approvalStatus 亦不可见），派单第一关「审批未通过(status=idle)」把
// 唯一队员淘汰、订单直进大厅。口径：status 为在线态值时视为该字段无资格事实，穿透读
// approvalStatus；status 为待审核/已拒绝等真资格事实时绝不穿透（防旧 approvalStatus 洗白）。
const PRESENCE_STATUS_TOKENS = new Set(['idle', 'busy', 'offline', 'online']);
function effectiveMemberStatus(doc: any): string {
  const st = String(doc?.status || '').trim();
  if (st && !PRESENCE_STATUS_TOKENS.has(st.toLowerCase())) return st;
  const ap = String(doc?.approvalStatus || '').trim();
  if (ap && !PRESENCE_STATUS_TOKENS.has(ap.toLowerCase())) return ap;
  return st || ap || '';
}
function squadPositionCodeFromRole(role: any): string {
  const r = String(role || '');
  if (r.includes('开发者')) return 'developer';
  if (r.includes('城市老板') || r.includes('总指挥官')) return 'boss';
  if (r.includes('城市管理')) return 'manager';
  if (r.includes('城市派单员')) return 'dispatcher';
  return 'normal';
}
// 管理等级：开发者5 / 老板4 / 管理3 / 派单员2 / 普通0（改名、调岗的目标保护与等级比较共用）
function membershipLevelUnified(m: any): number {
  // 2026-10-21 第二轮修复(P1)：squadPosition 只有管理编码可信；为 'normal'/空时必须回退 role 推导。
  // 旧实现 String(m?.squadPosition || ...) 把 'normal' 当真值直接采信：role 已升为老板但 position
  // 残留 'normal' 的人会被算成 0 级（调岗被误拒、管理可越级动他）。与 requireDbAuth 身份推导口径对齐。
  const posCode = String(m?.squadPosition || '');
  const code = (posCode === 'developer' || posCode === 'boss' || posCode === 'manager' || posCode === 'dispatcher')
    ? posCode
    : squadPositionCodeFromRole(m?.role || '');
  if (code === 'developer') return 5;
  if (code === 'boss') return 4;
  if (code === 'manager') return 3;
  if (code === 'dispatcher') return 2;
  return 0;
}
// 通用读：MySQL 优先，JSON 兜底（仅作档案类读取）
async function readCanonicalDocument(collection: string, docId: string): Promise<any | null> {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows]: any = await mysqlPool.query(
        'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
        [collection, docId]);
      if (rows && rows.length > 0) return parseStoredDoc(rows[0].data);
    } catch (e: any) {
      console.error('[CanonicalRead] MySQL error:', collection, docId, e?.message);
    }
  }
  const dbData = readLocalJsonDb();
  return dbData[collection]?.[docId] ?? null;
}
// 状态读：MySQL 启用时只认 MySQL（防本地旧文档让被删者复活/重批者被误拦）
async function readStatusDocument(collection: string, docId: string): Promise<any | null> {
  if (isMySQLEnabled && mysqlPool) {
    const [rows]: any = await mysqlPool.query(
      'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
      [collection, docId]);
    if (rows && rows.length > 0) return parseStoredDoc(rows[0].data);
    return null;
  }
  const dbData = readLocalJsonDb();
  return dbData[collection]?.[docId] ?? null;
}
// removed 名单双源合并（MySQL + 本地 JSON），全系统统一这一份
// 2026-10-23 第十六轮：removed 名单 5 秒缓存版，仅供高频通用写路径的在场守卫使用
// （专用接口仍走 fresh 合并读；移除生效在通用写侧最多延迟 5 秒，可接受）。
let _removedSetCache5s: { at: number; set: Set<string> } | null = null;
async function getRemovedSetCached5s(): Promise<Set<string>> {
  if (_removedSetCache5s && Date.now() - _removedSetCache5s.at < 5000) return _removedSetCache5s.set;
  const arr = await readRemovedPhonesMergedUnified().catch(() => [] as string[]);
  const set = new Set(arr.map((p) => normalizeDriverPhoneUnified(p)).filter(Boolean));
  _removedSetCache5s = { at: Date.now(), set };
  return set;
}

async function readRemovedPhonesMergedUnified(): Promise<string[]> {
  const set = new Set<string>();
  const addAll = (list: any) => {
    if (Array.isArray(list)) list.forEach((p: any) => {
      const c = normalizeDriverPhoneUnified(p);
      if (c) set.add(c);
    });
  };
  try { addAll(readLocalJsonDb().config?.['removed_squad_members']?.phones); } catch (_) {}
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows]: any = await mysqlPool.query(
        'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
        ['config', 'removed_squad_members']);
      if (rows && rows.length > 0) addAll(parseStoredDoc(rows[0].data)?.phones);
    } catch (e: any) {
      console.error('[RemovedList] MySQL read error:', e?.message);
    }
  }
  return Array.from(set);
}

// 2026-10-22 第七轮：司机「占用」改由服务端按事实计算，不再靠客户端写 isBusy 标记——
// 占用三来源：①行程中（driver_locations 文档 isBusy，调用方原样处理，不进本组函数）
// ②有未决派单（新来单弹窗已弹、60 秒内未处理）③报单页新鲜心跳（见 /api/driver/status 的 isReporting）。
// 2026-10-17「弹窗/报单置忙会自锁」的雷正源于把占用写进 isBusy 文档：claim 的 isBusy 守卫
// 会把司机挡在自己的接单门外。新口径只读事实、绝不回写 isBusy，故不自锁。
type PendingDispatchInfo = { orderId: string; expiresAt: number };
let _pendingDispatchCache: { at: number; map: Map<string, PendingDispatchInfo> } | null = null;
const PENDING_DISPATCH_CACHE_TTL_MS = 1500;
const REPORTING_FRESH_MS = 45000;

// 未决派单全图：merchant_orders 中 status='dispatched'、未接单（claimedDriverPhone 空）、
// 未进大厅（in_hall 不为 true）、dispatchExpiresAt 仍在未来者，按司机归一。
// 已过期未被定时器搬走的不算未决。读取口径与本文件其他处一致：本地 JSON 铺底、MySQL 覆盖合并。
// 2026-10-22 第八轮：按订单串行锁。同一订单的状态迁移请求（接单/抢单/拒单/取消/真取消/
// 转大厅/推进/完单）串行执行，消除 JSON 整库读-改-写被并发请求交错出的第三态
// （edge E2b：商户 true-cancel 与司机 claim 同毫秒并发时状态不自洽的根源）。
// 进程内 Promise 链实现：单进程部署下足够；等锁超过 60 秒按异常放行并打日志，防死等。
const orderLockChains = new Map<string, Promise<void>>();
async function acquireOrderLock(orderId: string): Promise<() => void> {
  const key = String(orderId || '').trim();
  if (!key) return () => {};
  const prev = orderLockChains.get(key) || Promise.resolve();
  let releaseFn: () => void = () => {};
  const current = new Promise<void>((resolve) => { releaseFn = resolve; });
  const chained = prev.then(() => current);
  orderLockChains.set(key, chained);
  chained.finally(() => { if (orderLockChains.get(key) === chained) orderLockChains.delete(key); });
  let timedOut = false;
  await Promise.race([
    prev,
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, 60000)),
  ]);
  if (timedOut) console.warn(`[OrderLock] 订单 ${key} 等锁超时60秒，按异常放行`);
  let released = false;
  return () => { if (!released) { released = true; releaseFn(); } };
}
function orderLockMiddleware(req: any, res: any, next: any) {
  const orderId = String((req.body && (req.body.orderId || req.body.id)) || '').trim();
  if (!orderId) return next();
  acquireOrderLock(orderId)
    .then((release) => {
      res.on('finish', release);
      res.on('close', release);
      next();
    })
    .catch(() => next());
}

async function scanPendingDispatchMap(): Promise<Map<string, PendingDispatchInfo>> {
  const map = new Map<string, PendingDispatchInfo>();
  const now = Date.now();
  const consider = (docId: string, o: any) => {
    if (!o) return;
    const phone = String(o.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
    if (!phone) return;
    const st = String(o.status || '').trim();
    // 2026-10-22 第七轮收尾：与超时清扫器口径对齐——submitted+已派司机也算未决；
    // dispatchExpiresAt 缺失时按 dispatchedAt+60秒 兜底（存量旧单形状）。
    if (st !== 'dispatched' && st !== 'submitted') return;
    if (String(o.claimedDriverPhone || '').trim()) return;
    if (o.in_hall === true || o.in_hall === 'true') return;
    const expiresAt = Number(o.dispatchExpiresAt || 0) || (Number(o.dispatchedAt || 0) > 0 ? Number(o.dispatchedAt) + 60000 : 0);
    if (!(expiresAt > now)) return;
    const prev = map.get(phone);
    if (!prev || expiresAt > prev.expiresAt) {
      map.set(phone, { orderId: String(docId || o.id || o.orderId || ''), expiresAt });
    }
  };
  // 2026-10-23 第二十五轮：与 loadMerchantOrdersCanonical 同口径——MySQL 启用时只认 MySQL。
  // 旧实现 JSON 铺底+MySQL 并集：consider 只登记不撤销，镜像里残留的 dispatched 旧态会把
  // 已接/已取消单的司机误登记为「有未决派单」（最长 60 秒窗口：派单误淘汰、抢单误报 409）。
  // MySQL 查询失败才回退镜像扫描，绝不并集。
  let scannedFromMySQL = false;
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows]: any = await mysqlPool.query(
        'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
        ['merchant_orders']
      );
      (rows || []).forEach((r: any) => {
        try { consider(String(r.doc_id || ''), typeof r.data === 'string' ? JSON.parse(r.data) : r.data); } catch (_) {}
      });
      scannedFromMySQL = true;
    } catch (_) {}
  }
  if (!scannedFromMySQL) {
    try {
      const mo = readLocalJsonDb()?.['merchant_orders'] || {};
      Object.keys(mo).forEach((k) => consider(k, mo[k]));
    } catch (_) {}
  }
  return map;
}

// 未决派单全图（带 1.5 秒 TTL 缓存，派单/附近等高频路径共用）；fresh=true 绕缓存现扫（写前复查用）
async function getPendingDispatchMap(fresh = false): Promise<Map<string, PendingDispatchInfo>> {
  if (!fresh && _pendingDispatchCache && (Date.now() - _pendingDispatchCache.at) < PENDING_DISPATCH_CACHE_TTL_MS) {
    return _pendingDispatchCache.map;
  }
  const map = await scanPendingDispatchMap();
  _pendingDispatchCache = { at: Date.now(), map };
  return map;
}

async function getPendingDispatchForPhone(rawPhone: any, fresh = false): Promise<PendingDispatchInfo | null> {
  const phone = String(rawPhone || '').replace(/\D/g, '').trim();
  if (!phone) return null;
  const map = await getPendingDispatchMap(fresh);
  return map.get(phone) || null;
}

// 2026-10-23 第二十一轮(H3)：行程占用按订单事实计算——司机已接单（claimedDriverPhone
// 为本人、未终态、未进大厅）的订单集合。isBusy 标志可被司机本人经通用写自清，
// 派单/抢单守卫若只读标志，「一人多单」防线可从写侧击穿；订单事实不可自改。
let _activeClaimedCache: { at: number; set: Set<string> } | null = null;
// 2026-10-23 第二十四轮：订单终态事实判定。终态不只看 status——取消/完成在多条写路径上
// 以 isCancelled / statusCategory 为准落库（订单中心徽章、claim 预检、转单守卫都认这三者），
// 占用守卫此前只认 status，分类已取消但 status 滞留 claimed 的单会被误判占用。
function isTerminalOrderFact(o: any): boolean {
  if (!o) return true;
  const st = String(o.status || '').trim();
  if (['completed', '已完成', 'cancelled', '已取消', 'true_cancelled', 'true-cancelled', 'hall', 'expired'].includes(st)) return true;
  if (o.isCancelled === true || o.isCancelled === 'true') return true;
  const cat = String(o.statusCategory || '');
  if (cat.includes('已取消') || cat.includes('已完成')) return true;
  return false;
}

// 2026-10-23 第二十四轮：订单事实的权威读取。MySQL 是唯一权威——JSON 镜像在并发
// 全量覆写下会丢订单状态更新（生产实证：司机取消单只落进 MySQL、镜像仍停在 claimed，
// 占用守卫按镜像误判「已有进行中的接单」，把唯一队员锁死、订单只能进大厅）。
// MySQL 可用时只读 MySQL；未启用或查询失败才回退镜像，绝不双源并集。
async function loadMerchantOrdersCanonical(): Promise<Array<[string, any]>> {
  if (isMySQLEnabled && mysqlPool) {
    try {
      const [rows]: any = await mysqlPool.query(
        'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
        ['merchant_orders']
      );
      return (rows || []).map((r: any) => [String(r.doc_id || ''), typeof r.data === 'string' ? parseStoredDoc(r.data) : r.data] as [string, any]);
    } catch (_) { /* 查询失败回退镜像 */ }
  }
  try {
    const mo = readLocalJsonDb()?.['merchant_orders'] || {};
    return Object.keys(mo).map((k) => [k, mo[k]] as [string, any]);
  } catch (_) { return []; }
}

async function getActiveClaimedDriverSet(): Promise<Set<string>> {
  if (_activeClaimedCache && (Date.now() - _activeClaimedCache.at) < PENDING_DISPATCH_CACHE_TTL_MS) {
    return _activeClaimedCache.set;
  }
  const set = new Set<string>();
  const consider = (o: any) => {
    if (!o) return;
    const claimed = String(o.claimedDriverPhone || '').replace(/\D/g, '').trim();
    if (!claimed) return;
    if (o.in_hall === true || o.in_hall === 'true') return;
    if (isTerminalOrderFact(o)) return;
    set.add(claimed);
  };
  const docs = await loadMerchantOrdersCanonical();
  docs.forEach(([, o]) => consider(o));
  _activeClaimedCache = { at: Date.now(), set };
  return set;
}

async function findDriverActiveOrderId(phone: string, exceptOrderId: string): Promise<string | null> {
  const consider = (docId: string, o: any): string | null => {
    if (!o) return null;
    const oid = String(docId || o.id || o.orderId || '');
    if (oid && oid === exceptOrderId) return null;
    const claimed = String(o.claimedDriverPhone || '').replace(/\D/g, '').trim();
    if (claimed !== phone) return null;
    if (o.in_hall === true || o.in_hall === 'true') return null;
    if (isTerminalOrderFact(o)) return null;
    return oid || 'unknown';
  };
  const docs = await loadMerchantOrdersCanonical();
  for (const [k, o] of docs) { const r = consider(k, o); if (r) return r; }
  return null;
}

// 占用判定（不含行程 isBusy，行程由调用方按文档原样处理）：
// 未决派单优先，其次报单页新鲜心跳。docLike 传 driver_locations 文档（带 isReporting/reportingAt）。
function occupancyOf(phone: string, pendingMap: Map<string, PendingDispatchInfo> | null, docLike: any): { occupied: boolean; reason: 'pending' | 'reporting' | null } {
  if (pendingMap && phone && pendingMap.has(phone)) return { occupied: true, reason: 'pending' };
  const rep = docLike?.isReporting === true || docLike?.isReporting === 'true';
  const repAt = Number(docLike?.reportingAt || 0);
  if (rep && repAt > 0 && (Date.now() - repAt) < REPORTING_FRESH_MS) return { occupied: true, reason: 'reporting' };
  return { occupied: false, reason: null };
}

// 统一成员状态：所有服务端判定（鉴权/派单/抢单/名单/申请）共用
async function getUnifiedMembership(rawPhone: any): Promise<any> {
  const phone = normalizeDriverPhoneUnified(rawPhone);
  const isDeveloper = phone === DEVELOPER_PHONE_SERVER;
  if (!phone) {
    return { phone, isDeveloper: false, isRemoved: false, isMember: false, phase: 'none',
      memberStatus: '', applicationStatus: '', memberDoc: null, applicationDoc: null, driverDoc: null,
      role: '', squadPosition: '', licenseExpiry: '待开通', vipExpiry: '待开通', removedPhones: [] };
  }
  const removedPhones = await readRemovedPhonesMergedUnified();
  const isRemoved = !isDeveloper && removedPhones.includes(phone);
  const memberDoc = await readStatusDocument('squad_members', phone);
  const applicationDoc = await readStatusDocument('squad_applications', phone);
  const driverDoc = await readCanonicalDocument('driver_users', phone);
  const memberStatus = effectiveMemberStatus(memberDoc);
  const isMember = isDeveloper || (!isRemoved && !!memberDoc && isApprovedMemberStatus(memberStatus));
  const applicationStatus = effectiveMemberStatus(applicationDoc);
  let phase = 'none';
  if (isMember) phase = 'member';
  else if (['待审核', 'pending', '审核中'].includes(applicationStatus)) phase = 'pending';
  else if (applicationStatus === '已拒绝') phase = 'rejected';
  else if (isRemoved) phase = 'removed';
  const pickLic = (v: any): string => {
    const t = String(v ?? '').trim();
    return (t && t !== '待开通') ? t : '';
  };
  const licenseExpiry = pickLic(driverDoc?.licenseExpiry) || pickLic(memberDoc?.licenseExpiry) || '待开通';
  const vipRaw = String(driverDoc?.vipExpiry ?? memberDoc?.vipExpiry ?? '').trim();
  return {
    phone, isDeveloper, isRemoved, isMember, phase,
    memberStatus, applicationStatus, memberDoc, applicationDoc, driverDoc, removedPhones,
    role: String(memberDoc?.role || memberDoc?.userRole || driverDoc?.role || driverDoc?.userRole || ''),
    squadPosition: String(memberDoc?.squad_position || ''),
    licenseExpiry,
    vipExpiry: vipRaw || '待开通',
  };
}

// 2026-10-22 第六轮(授权/VIP口径统一)：司机授权/VIP 到期读取的唯一口径。
// 来源优先级：squad_members 权威状态文档优先、driver_users 档案兜底；空/'待开通' 视为无值继续兜底。
// claim / driver-claim / nearest / report-transfer / qr-phone-notify 全部改走这里，
// 禁止再各读一表（曾出现「driver_users 有值却读 squad_members 空值 → 不派但能抢」类分叉）。
// 注意：只统一来源与别名，不改天数语义（授权=日期差、VIP=到期日 23:59，均为用户定案）。
function resolveExpiryFromDocs(memberDoc: any, driverDoc: any): { licenseExpiry: string; vipExpiry: string } {
  const pick = (v: any): string => {
    const t = String(v ?? '').trim();
    return (t && t !== '待开通') ? t : '';
  };
  return {
    licenseExpiry: pick(memberDoc?.licenseExpiry) || pick(driverDoc?.licenseExpiry) || '待开通',
    vipExpiry: pick(memberDoc?.vipExpiry) || pick(driverDoc?.vipExpiry) || '待开通',
  };
}
async function readDriverExpiryUnified(rawPhone: any): Promise<{ licenseExpiry: string; vipExpiry: string }> {
  const phone = normalizeDriverPhoneUnified(rawPhone);
  if (!phone) return { licenseExpiry: '待开通', vipExpiry: '待开通' };
  const memberDoc = await readStatusDocument('squad_members', phone);
  const driverDoc = await readCanonicalDocument('driver_users', phone);
  return resolveExpiryFromDocs(memberDoc, driverDoc);
}
// 专用接口 MySQL 分支后，把同一结果同步进本地 JSON（防双存储分叉复活/误拦）
function syncLocalApprove(phone: string, memberPayload: any) {
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
    if (db.driver_locations?.[phone]) db.driver_locations[phone] = { ...db.driver_locations[phone], isOnline: true }; // 2026-10-22 第八轮：与 remove 的标离线成对——重加恢复在线，立即可派单
    if (db.config?.['removed_squad_members']?.phones) {
      db.config['removed_squad_members'] = {
        phones: db.config['removed_squad_members'].phones.map((p: any) => String(p).trim()).filter((p: string) => p && p !== phone),
        updatedAt: new Date().toISOString(),
      };
    }
    writeLocalJsonDb(db);
  } catch (_) {}
}
function syncLocalRemove(phone: string, driverPayload: any) {
  try {
    const db = readLocalJsonDb();
    if (db.squad_members) delete db.squad_members[phone];
    if (db.squad_applications) delete db.squad_applications[phone];
    if (db.team_members) delete db.team_members[phone];
    if (db.driver_locations?.[phone]) db.driver_locations[phone] = { ...db.driver_locations[phone], isOnline: false, isBusy: false }; // 2026-10-22 第八轮：删人不删定位文档（坐标只此一份，删了重加后无从恢复、派单永远跳过他；App 还开着时下一次 GPS 上报本就会重写，删除只坑 App 没在跑的人）。改为标记离线：被删期间成员过滤挡派单、附近页成员过滤+离线双挡显示；重加审批时恢复在线即可立刻接单。
    // 2026-10-20 重构(M6)：同步清线上单开通、乘客链接与进行中订单槽位，防残留指向已删司机
    if (db.online_applications) delete db.online_applications[phone];
    if (db.passenger_links) delete db.passenger_links[phone];
    if (db.active_orders) delete db.active_orders[phone];
    if (!db.driver_users) db.driver_users = {};
    db.driver_users[phone] = driverPayload;
    if (!db.config) db.config = {};
    const cur = db.config['removed_squad_members']?.phones || [];
    const phones = Array.from(new Set([...cur.map((p: any) => String(p).trim()).filter(Boolean), phone]));
    db.config['removed_squad_members'] = { phones, updatedAt: new Date().toISOString() };
    writeLocalJsonDb(db);
  } catch (_) {}
}
function syncLocalReject(phone: string, mergedApp: any) {
  try {
    const db = readLocalJsonDb();
    if (!db.squad_applications) db.squad_applications = {};
    db.squad_applications[phone] = mergedApp;
    writeLocalJsonDb(db);
  } catch (_) {}
}
function syncLocalWithdraw(phone: string) {
  try {
    const db = readLocalJsonDb();
    if (db.squad_applications) delete db.squad_applications[phone];
    writeLocalJsonDb(db);
  } catch (_) {}
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

  // 无GPS强制下线（用户需求：大退/关机/断网的司机不占用派单，
  // 避免高峰期订单派给死司机空等60秒；司机重新上线后自动恢复）
  // 每30秒扫描一次，lastLocationTime 超阈值未更新 → isOnline=false
  // 2026-10-24 第四十二轮：阈值 120 秒 → 300 秒。背景：App 已接入原生后台定位
  // （@capacitor-community/background-geolocation），切后台/锁屏持续上报，旧 120 秒
  // 阈值的误踢主因（JS 后台冻结）已消除；但 iOS 对静止设备后台定位仍可拉长间隔，
  // 120 秒会误踢活司机。不能整删看门狗：派单主链路的 120 秒新鲜度门禁已于
  // 2026-10-17 按用户要求移除，看门狗是死司机退出候选的唯一机制，删之则订单
  // 重回派给关机/大退司机。放宽到 300 秒后：死司机最迟 5 分钟退出候选（其间订单
  // 由新来单页 35 秒无心跳兜底转大厅），活司机不再被间隔抖动误踢。
  const GPS_OFFLINE_THRESHOLD_MS = 300 * 1000;
  setInterval(() => {
    try {
      const dbData: any = readLocalJsonDb();
      const locs = dbData?.driver_locations;
      if (!locs || typeof locs !== 'object') return;
      const now = Date.now();
      let kicked = 0;
      let changed = false;
      const kickedPhones: string[] = [];
      for (const k of Object.keys(locs)) {
        const item = locs[k];
        if (!item || item.isOnline !== true) continue;
        const t = docLatestTimeMs(item); // 2026-10-24：取全部时间字段最大值，防陈旧字段遮蔽新鲜上报误踢（见 docLatestTimeMs 注释）
        // M2修复：无时间戳(t<=0)按过期处理（fail-safe），幽灵司机不再永生
        if (now - t > GPS_OFFLINE_THRESHOLD_MS) {
          locs[k] = { ...item, isOnline: false, onlineOrdersEnabled: false, kickedOfflineAt: now, kickReason: 'gps_timeout_300s' };
          kicked++;
          kickedPhones.push(k);
          changed = true;
        }
      }
      if (changed) {
        writeLocalJsonDb(dbData);
        if (kicked > 0) console.log(`[GPS看门狗] ${kicked} 名司机300秒无GPS，已强制下线`);
        // 2026-10-21 第四轮(P1-1)：看门狗此前只写本地 JSON——派单组装位置图以 MySQL 为准，
        // MySQL 行永远停在 isOnline=true，关掉 App 的司机仍被持续派单。用 JSON_MERGE_PATCH
        // 把踢下线同步到 MySQL（只改在线字段，不整档覆盖位置文档）。
        if (isMySQLEnabled && mysqlPool && kickedPhones.length > 0) {
          const kickPatch = JSON.stringify({ isOnline: false, onlineOrdersEnabled: false, kickedOfflineAt: now, kickReason: 'gps_timeout_300s' });
          for (const kp of kickedPhones) {
            mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = JSON_MERGE_PATCH(`data`, ?) WHERE `collection` = ? AND `doc_id` = ?',
              [kickPatch, 'driver_locations', kp]
            ).catch(() => {});
          }
        }
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-Requested-With, Keep-Alive, User-Agent, Cache-Control, X-App-Version');
    // 2026-10-24 第四十二轮：补预检缓存。此前未下发 Max-Age，WebView 对每个带
    // X-Auth-Token 的请求都先发一次 OPTIONS 预检（生产日志中请求数因此翻倍、
    // nginx 占用异常）。下发 24 小时后，同一 URL 的预检在 WebView 内缓存复用。
    res.setHeader('Access-Control-Max-Age', '86400');
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


  // 2026-10-22 第六轮：purgeMockDriverData 与 consolidateAllDriversOnStartup 函数体已整段删除
  // （均无调用方：purge 的启动自动执行早已禁用——它曾是重启删光真实司机的元凶；
  // consolidate 的启动调用也早已删除）。清理测试号只走显式流程 + 停服离线清洗。


  // 2026-10-20 重建：禁用启动 consolidation 写逻辑。它按“成员表有文档”推断已通过，
  // 会把无 status 的壳/残留申请洗成正式成员（状态制造机），与统一状态机冲突。
  // 2026-10-22 第六轮：consolidateAllDriversOnStartup 函数体已整段删除（无任何调用方）；
  // 数据一致性由专用接口双写 + 离线清洗保证。
  console.log('[Membership] startup consolidation disabled (unified state machine)');

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
    // 2026-10-21 第四轮：公开 TTS 代理此前无长度上限、无限流，可被白嫖刷量。语音播报文本都很短：
    // 限 200 字 + 单 IP 60 次/分钟（客户端用 <audio> 直连无法带鉴权头，故不做 token 校验）。
    if (text.length > 200) {
      return res.status(400).send('Text too long');
    }
    try {
      const ttsIp = getClientIp(req);
      if (!(global as any).__ttsLogs) (global as any).__ttsLogs = new Map();
      const ttsLogs: Map<string, number[]> = (global as any).__ttsLogs;
      const tNow = Date.now();
      const tArr = (ttsLogs.get(ttsIp) || []).filter(t => tNow - t < 60000);
      if (tArr.length >= 60) {
        return res.status(429).send('Too many requests');
      }
      tArr.push(tNow);
      ttsLogs.set(ttsIp, tArr);
    } catch (_) {}

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
  const requireDbAuth = async (req: any, res: any, next: any) => {
    const token = req.headers['x-auth-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ success: false, error: '未登录：缺少认证令牌，请先短信验证登录' });
    }
    // 2026-10-18 有状态鉴权优先（一号一token终身制，MySQL持久化）；
    // 回退：登录内存 Map（同一 st_ token 的会话缓存）
    let info: { phone: string; scope: string; isMerchant: boolean; createdAt: number } | null = null;
    try {
      const persistent = await verifyPersistentToken(String(token));
      if (persistent) {
        info = { phone: persistent.phone, scope: persistent.scope, isMerchant: persistent.isMerchant, createdAt: 0 };
      }
    } catch (_) {}
    if (!info) {
      // 2026-10-21 第三轮：v1 HMAC 验签回退已删除（见文件头说明），不再接受自签 token
      info = (authTokens.get(String(token)) as any) || null;
    }
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
    // V1.0 拦截（2026-10-19）：V1.0 的 App 不发送 appVersion 字段，V2.0 会发送 'V2.0'
    // V1.0 已强制升级，拒绝其通过 /api/db/* 的写操作，防止旧数据污染数据库
    // 只拦 /api/db/* 通用数据接口（V1.0 污染主渠道）；其他业务接口（上传收款码等）
    // 是 V2.0 专属，V1.0 不会调用，且 App 没发 appVersion，不能误拦
    // 开发者（管理后台）已在上面放行，不受影响
    const appVersion = String(req.body?.appVersion || (req.headers as any)?.['x-app-version'] || '').trim();
    const isDbWrite = req.path.startsWith('/api/db/') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(String(req.method || '').toUpperCase());
    if (isDbWrite && !appVersion.startsWith('V2')) {
      console.warn(`[V1Block] 拒绝 V1.0 写操作: 手机=${info.phone}, 路径=${req.path}, 版本=${appVersion || '(无)'}`);
      return res.status(403).json({
        success: false,
        error: '请升级到 V2.0 版本后使用',
        needUpgrade: true,
        minVersion: 'V2.0'
      });
    }
    // M10：从 squad_members 查操作者角色（同步读本地缓存）
    let userRole = 'normal';
    try {
      const purePhone = infoPhoneNorm.replace(/A$/, '');
      // 2026-10-20 重建：角色推导改读权威成员记录（MySQL 优先），不再只读本地 JSON
      const memberDoc = (await readStatusDocument('squad_members', purePhone)) || (await readStatusDocument('squad_members', info.phone)) || {};
      // 2026-10-22 第六轮：角色推导加成员资格门——status 必须已通过且不在 removed 双源合并名单。
      // 旧实现只看 squad_position/role 字符串：非成员残留职位文档、被移除者都能推导出管理作用域。
      let roleEligible = isApprovedMemberStatus(effectiveMemberStatus(memberDoc));
      if (roleEligible && purePhone !== DEVELOPER_PHONE_SERVER) {
        try {
          const removedForRole = await readRemovedPhonesMergedUnified();
          if (removedForRole.includes(purePhone)) roleEligible = false;
        } catch (_) {}
      }
      const pos = roleEligible ? String(memberDoc.squad_position || '').trim().toLowerCase() : '';
      if (pos === 'boss' || pos === 'manager' || pos === 'dispatcher') userRole = pos;
      if (userRole === 'normal' && roleEligible) {
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
    // 2026-10-23 第二十一轮(M4)：定位表不走管理层通用写放行——城市管理/老板经 db/set
    // 改他人 driver_locations（挪坐标/置离线/置忙碌）等效绕过等级链软封同行，而
    // remove/set-role 专用接口会被等级链拦下。定位只许本人写、开发者任意写。
    if ((req as any).isManager && colName === 'driver_locations' && ['/api/db/set', '/api/db/save', '/api/db/update', '/api/db/delete', '/api/db/add'].includes(req.path)) {
      const ownDigits = infoPhoneNorm.replace(/\D/g, '');
      const tgtDigits = targetId.replace(/\D/g, '');
      if (!targetId || tgtDigits !== ownDigits) {
        return res.status(403).json({ success: false, error: '定位数据只能由司机本人修改' });
      }
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
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
      '/api/dispatch/countdown',
      '/api/order/countdown',
      '/api/order/claim',
      '/api/order/driver-claim',
      '/api/order/cancel',
      '/api/order/complete',
      '/api/order/to-hall',
      '/api/order/true-cancel',
      '/api/order/progress',
      '/api/dispatch/nearest',
      '/api/dispatch/page-heartbeat',
      '/api/driver/location',
      '/api/driver/locations',
      '/api/driver/status',
      '/api/driver/offline',
      '/api/driver/name',
      '/api/db/get',
      '/api/db/list',
      '/api/geocode',
      '/api/geo/locate',
      '/api/auth/logout',
      // 2026-10-18修：收款码上传/删除/获取、入队申请，这些接口传 phone 不传 id，
      // 不加白名单会被 H9 的"无目标id批量操作"逻辑误杀 403
      '/api/upload-wechat-qr',
      '/api/delete-wechat-qr',
      '/api/get-wechat-qr',
      '/api/squad-apply',
      // 2026-10-18补：二维码通知、VIP兑换、小队成员列表，业务接口有自己的鉴权，
      // 不走通用 id 归属检查，避免订单号等非手机号 id 被误杀
      '/api/qr-notify-check',
      '/api/vip-code-check',
      '/api/vip-code-redeem',
      '/api/squad/members',
    ]);
    if (BUSINESS_PATHS.has(req.path)) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // H9修复（2026-10-18重构）：无目标文档id的批量操作拦截只针对 /api/db/* 通用数据接口
    // （如 clear-collection 清空整表必须要求管理员）。
    // 业务接口（/api/upload-wechat-qr、/api/squad-apply、/api/qr-notify-check 等）
    // 有自己的鉴权逻辑（验手机号匹配等），不走这个通用拦截，避免误杀。
    // 之前用白名单一个个加，漏了就 403（如 15121904440 传码被误杀）。
    if (req.path.startsWith('/api/db/')) {
      if (!targetId) {
        // /api/db/add 未指定 id 时服务端生成随机 id，允许普通用户创建新文档
        const isAddWithGeneratedId = req.path === '/api/db/add' && !req.body?.data?.id;
        if (!isAddWithGeneratedId) {
          console.warn(`[Auth] 拒绝无目标id的批量操作: token手机=${info.phone}, 路径=${req.path}`);
          return res.status(403).json({ success: false, error: '该操作需要管理员权限' });
        }
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
    // 2026-10-20 重建：该一键全清接口与统一状态机冲突（不删 team_members/auth_tokens、无备份无审计），
    // 生产环境禁用。数据清理一律走“停服+整表备份+离线清洗脚本”流程。
    return res.status(410).json({
      success: false,
      error: '该清理接口已禁用：请走停服备份清洗流程'
    });
    // 2026-10-22 第六轮：410 之后原有一段调用 purgeMockDriverData 的不可达 try 块已删除
    // （该函数体已整段下线）；本接口仅保留 410 壳。
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
      // 2026-10-21 第二轮修复(P0)：auth_tokens 是全员终身 token 的明文存储、vip_codes 是未兑换的兑换码，
      // 禁止经通用接口读取（任何登录用户逐个拉走即可冒充他人/自助兑码）。登录与兑换走各自专用接口，不经此处。
      // 2026-10-23 第十三轮修复：vip_codes 对开发者本人豁免——管理后台「兑换码库管理」必须
      // 列表/查看兑换码（订阅 vip_codes 是后台挂载动作），一刀切禁读连开发者一起拦，后台
      // 每次打开都报 DB Query failed: 403 误入脱机状态。auth_tokens 维持全员禁读（无通用读需求）。
      const isDevGet = (() => { const p = String((req as any).authPhone || '').trim().toUpperCase(); return p === DEVELOPER_PHONE_SERVER || p === DEVELOPER_PHONE_SERVER + 'A'; })();
      if (col === 'auth_tokens' || (col === 'vip_codes' && !isDevGet)) {
        return res.status(403).json({ exists: false, error: '禁止读取该集合' });
      }
      // config 集合允许读（城市配置、总开关等），但禁止读敏感子文档
      if (col === 'config' && (docId === 'tokenSecret' || docId.startsWith('_'))) {
        return res.status(403).json({ exists: false, error: '禁止读取系统配置' });
      }

      // P1(2026-10-15)：敏感集合的单文档读取加权限控制，非管理员只能读自己的文档
      const requesterPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdminUser = requesterPhone === DEVELOPER_PHONE_SERVER;
      const cleanPhone = docId.replace(/\D/g, '').trim();
      const sensitiveSingleCols = ['driver_users', 'squad_members', 'online_applications', 'driver_locations'];
      if (sensitiveSingleCols.includes(col) && !isAdminUser) {
        if (docId !== requesterPhone && cleanPhone !== requesterPhone) {
          return res.status(403).json({ exists: false, error: '无权读取他人档案' });
        }
      }

      // 2026-10-20 重建：只返回所请求集合的原始文档。
      // 旧逻辑跨 driver_users/squad_members/online_applications/squad_applications 拼装，
      // 并用“任一已拒绝优先、否则一律已通过”伪造 status，是状态闪烁/误判成员的源头之一；
      // 同时旧逻辑对开发者 GET 还会写库，一并废除。状态判定统一走 getUnifiedMembership。
      const foundData = await readCanonicalDocument(col, docId);
      if (foundData) {
        // 2026-10-21 第三轮(P1-3)：passenger_links 文档含乘客手机号等敏感内容，此前任何登录用户
        // 凭司机手机号即可整表直读。乘客页(PassengerOrderView)实际只需要司机的公开信息：
        // 非本人/非开发者读取时只返回公开字段子集。
        if (col === 'passenger_links' && !isAdminUser && cleanPhone !== requesterPhone) {
          const pub: any = {};
          for (const f of ['driverStartLocation', 'driverBrandName', 'vipExpiry', 'driverName', 'customAppName', 'phone', 'updatedAt']) {
            if ((foundData as any)[f] !== undefined) pub[f] = (foundData as any)[f];
          }
          return res.json({ exists: true, id: docId, data: pub });
        }
        // 2026-10-21 第三轮(P1-3)：订单文档含乘客手机号/地址，订单号是时间戳型可猜。
        // 非管理层读取须为订单相关方（下单/被派/接单/报单/乘客任一），否则 403。
        if (['merchant_orders', 'valet_orders'].includes(col) && !isAdminUser && !(req as any).isManager) {
          const d: any = foundData;
          const parties = [d.dispatchedDriverPhone, d.claimedDriverPhone, d.reporterPhone, d.merchantPhone, d.orderPhone, d.passengerPhone, d.dispatchedByPhone, d.createdBy, d.driverPhone]
            .map((v: any) => String(v || '').replace(/\D/g, '')).filter(Boolean);
          if (!parties.includes(requesterPhone)) {
            return res.status(403).json({ exists: false, error: '无权读取他人订单' });
          }
        }
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
      // 2026-10-21 第二轮修复(P0)：auth_tokens/vip_codes 禁止整表拉取（理由同 /api/db/get）。
      // 2026-10-23 第十三轮修复：vip_codes 对开发者本人豁免（后台兑换码库管理需整表读，
      // 一刀切拦截致后台挂载即报 403 脱机）；auth_tokens 维持全员禁拉。
      const isDevList = (() => { const p = String((req as any).authPhone || '').trim().toUpperCase(); return p === DEVELOPER_PHONE_SERVER || p === DEVELOPER_PHONE_SERVER + 'A'; })();
      if (col === 'auth_tokens' || (col === 'vip_codes' && !isDevList)) {
        return res.status(403).json({ docs: [], error: '禁止读取该集合' });
      }
      // 2026-10-23 第二十轮：where() 约束服务端从未实现过滤，旧口径静默忽略、返回整表
      // （调用方以为已过滤——隐私与性能双输）。无任何现网调用点，改为显式 400  fail-closed。
      if (req.query.constraints) {
        try {
          const parsedConstraints = JSON.parse(String(req.query.constraints));
          if (Array.isArray(parsedConstraints) && parsedConstraints.length > 0) {
            return res.status(400).json({ docs: [], error: 'constraints 查询约束暂不支持' });
          }
        } catch (_) {
          return res.status(400).json({ docs: [], error: 'constraints 参数无效' });
        }
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
      const sensitiveCols = ['driver_users', 'squad_members', 'online_applications', 'driver_locations', 'passenger_links'];
      // 2026-10-23 第三十四轮：passenger_links 一并纳入本人限定——文档键即司机手机号，
      // 内含其乘客的手机号；此前整表对任何登录司机开放，可枚举全队乘客联系方式。
      // 客户端只有按本人 doc 的单文档订阅，无整表消费方，收紧零影响。
      const isSensitive = sensitiveCols.includes(col);
      let forcedDocId: string | null = null;
      if (isSensitive && !isAdmin) {
        if (!requesterPhone) {
          return res.status(403).json({ docs: [], error: '无权批量读取' });
        }
        forcedDocId = requesterPhone; // 强制只读本人
      }

      // 2026-10-23 第三十四轮：订单列表的乘客手机号脱敏。db/list 对订单集合此前只拦
      // removed 名单，任何登录司机都能整表拉到全部订单的乘客真实手机号（单文档 GET
      // 早已按关联人 403，两个读口径不一致）。口径：工作人员（开发者/管理员/管理/
      // 派单员）与订单关联人（商户/被派/接单/报单司机）看真号，其余一律打码——
      // 大厅抢单不需要乘客号，接单后本人即成关联人、真号自动可见，App 流程不受影响。
      const maskPhoneForList = (v: any): string => {
        const digits = String(v || '').replace(/\D/g, '').trim();
        if (!digits) return String(v || '');
        if (digits.length < 7) return '****';
        return digits.slice(0, 3) + '****' + digits.slice(-4);
      };
      // 2026-10-24 第四十二轮续修2：列表载荷瘦身。driver_users/squad_members 文档内嵌
      // 收款码 base64，是整表体积（实测 94KB）的主要来源；而全部列表消费方（派单台/
      // 大厅/小队名单/管理后台）从不从列表里读他人收款码——收款码只走单文档 GET 或
      // /api/get-wechat-qr 专用口。本人文档保留全字段；他人文档删除 QR 类字段
      // （删除而非置空：客户端若把列表文档 merge 回写，缺失字段不会冲掉库里的真码）。
      const QR_SLIM_FIELDS = ['wechatQrCode', 'qrCode', 'wechatClean', 'alipayQrCode', 'paymentQrCode', 'driverQrCode', 'qrcode_url'];
      const slimListQrFields = (doc: any) => {
        if (!doc || !['driver_users', 'squad_members'].includes(col)) return;
        const docDigits = String(doc.id || '').replace(/\D/g, '').trim();
        if (requesterPhone && docDigits === requesterPhone) return;
        for (const f of QR_SLIM_FIELDS) {
          if (doc[f] !== undefined) delete doc[f];
          if (doc.data && doc.data[f] !== undefined) delete doc.data[f];
        }
      };
      const listStaff = isDevList || (req as any).isAdmin === true || (req as any).isManager === true || (req as any).isDispatcher === true;
      const redactOrderPii = (doc: any) => {
        if (listStaff || !doc) return;
        const me = requesterPhone;
        const involved = [doc.merchantPhone, doc.dispatchedDriverPhone, doc.claimedDriverPhone, doc.reporterPhone, doc.driverPhone]
          .map((x: any) => String(x || '').replace(/\D/g, '').trim());
        if (me && involved.includes(me)) return;
        for (const f of ['passengerPhone', 'customerPhone', 'contactPhone', 'passengerTel', 'passengerMobile']) {
          if (doc[f]) doc[f] = maskPhoneForList(doc[f]);
          if (doc.data && doc.data[f]) doc.data[f] = maskPhoneForList(doc.data[f]);
        }
      };

      // P0(2026-10-16)：函数顶层统一初始化，MySQL 分支与 JSON 分支共用。
      // 修复生产运行时 ReferenceError：① dbData 在 MySQL 分支声明前使用（TDZ）；
      // ② isOrdersCol 仅在 MySQL 块内声明、JSON 过滤块却引用它。
      const dbData = readLocalJsonDb();
      const isDriverCol = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col);
      const isOrdersCol = ['merchant_orders', 'valet_orders', 'orders'].includes(col);
      // 2026-10-21 第四轮(P2-4)：removed 名单改走双源合并（此前只读本地 JSON config，
      // MySQL 模式下 JSON 副本过期就漏拦，被移除者仍能从 list 看到订单）。
      const removedArr: string[] = await readRemovedPhonesMergedUnified().catch(() => (dbData.config?.['removed_squad_members']?.phones || []));
      const clearedTimestamp = Number(dbData.config?.['merchant_orders_cleared']?.clearedAt || 0);

      // P1-2修复(2026-10-14)：用 token 解析出的真实身份，不信任客户端传的手机号（可伪造/可省略绕过）
      // 被移出小队的司机一律不返回订单（MySQL/JSON 双分支统一生效）
      if (isOrdersCol && requesterPhone && requesterPhone !== '15509601222') {
        if (removedArr.includes(requesterPhone)) {
          return res.json({ docs: [], list: [], data: [] });
        }
      }

      // 2026-10-24 第四十二轮续修5：增量水位。响应回传本批文档的最大 updated_at，
      // 客户端下次以此作 since 只拉增量（合并+60 秒全量对账兜底删除）；增量为空时
      // 回显客户端的 since，防其水位倒退。
      let listWatermark: string | null = hasValidSince ? sinceParam : null;
      if (isMySQLEnabled && mysqlPool) {
        try {
          let rows: any;
          if (forcedDocId) {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data`, `updated_at` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, forcedDocId]
            );
          } else if (hasValidSince) {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data`, `updated_at` FROM `daijia_documents` WHERE `collection` = ? AND `updated_at` > ? ORDER BY `updated_at` DESC LIMIT ?',
              [col, sinceDate, limitNum]
            );
          } else {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data`, `updated_at` FROM `daijia_documents` WHERE `collection` = ? ORDER BY `updated_at` DESC LIMIT ?',
              [col, limitNum]
            );
          }
          for (const r of (rows || [])) {
            const u = (r as any).updated_at ? new Date((r as any).updated_at) : null;
            if (u && !isNaN(u.getTime())) {
              const iso = u.toISOString();
              if (!listWatermark || iso > listWatermark) listWatermark = iso;
            }
          }
          const now = new Date();
          const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          target50d.setDate(target50d.getDate() + 50);
          const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

          const docs = (rows || []).map((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const obj = typeof data === 'object' && data !== null ? { ...data } : {};
            return { ...obj, id: r.doc_id, data: obj }; // 第六轮(P0-1)：键 doc_id 必须压过内嵌 id
          }).filter((doc: any) => {
            // 2026-10-22 第六轮(P0-1)：身份一律以集合键 doc_id 为准（上方 map 已保证 doc.id=doc_id，
            // 不再被文档内嵌 id 如 'app-<时间戳>' 覆盖）；手机号取 phone 字段、缺失才以键兜底。
            const docIdStr = String(doc.id || '').trim();
            const phoneStr = String(doc.phone || docIdStr || '').trim();
            const cleanPhone = phoneStr.replace(/\D/g, '').trim();
            const hasASuffix = docIdStr.toUpperCase().endsWith('A') || phoneStr.toUpperCase().endsWith('A');

            if (col === 'squad_applications') {
              // 第六轮：删除通用名规则——旧规则使「通用名+未拒绝」的待审申请在所有列表不可见（P0-1 主因）；
              // 保留 A 后缀/商户字段/开发者三项排除。
              if (hasASuffix || doc.isMerchant || doc.accountType === 'merchant') return false;
              if (cleanPhone === '15509601222') return false;
              return true;
            }

            if (col === 'online_applications') {
              // Online applications: Keep 15509601222 developer driver resident; exclude legacy deleted mock drivers
              if (cleanPhone === '15509601222') return true;
              if (hasASuffix || doc.isMerchant) return false;
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
              if (hasASuffix) return false; // Merchant A accounts go to merchant_accounts only
              // 第六轮(G-P2)：删除通用名整行隐藏——管理后台必须显示所有司机（2026-10-19 用户裁定）
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

          return res.json({ docs, list: docs, data: docs, watermark: listWatermark });
        } catch (mysqlErr: any) {
          console.error('[DB Proxy LIST MySQL Error]:', mysqlErr);
          // P0(2026-10-16)：MySQL 已启用时查询失败必须明确返回 500，
          // 禁止静默回退本地 JSON（旧数据/空数据会造成"空列表假成功"）
          return res.status(500).json({ docs: [], error: 'MySQL 查询失败: ' + (mysqlErr?.message || 'unknown') });
        }
      }

      // JSON DB Fallback（仅 MySQL 未启用时走这里；dbData 已在函数顶部初始化）
      const colData = dbData[col] || {};
      // 第四十二轮续修5（JSON 分支增量 parity）：无 updated_at 列，按文档内时间戳
      // 字段近似过滤；无任何时间戳的文档不进增量，靠客户端 60 秒全量对账兜底。
      // 水位取查询时刻（与 MySQL 分支的 max(updated_at) 语义近似）。
      listWatermark = new Date().toISOString();
      const sinceMsJ = hasValidSince && sinceDate ? sinceDate.getTime() : 0;

      const docs = Object.keys(colData).map((k) => {
        const itemData = colData[k];
        const obj = typeof itemData === 'object' && itemData !== null ? { ...itemData } : {};
        return {
          ...obj,
          id: k, // 第六轮(P0-1)：键 k 必须压过内嵌 id
          data: obj
        };
      }).filter((doc: any) => {
        // P1(2026-10-15)：敏感集合非管理员只能看自己的文档
        if (forcedDocId) {
          const docIdStr = String(doc.id || '').trim();
          if (docIdStr !== forcedDocId) return false;
        }
        // 第四十二轮续修5：增量过滤置于过滤链顶部（各集合的 return true 快捷分支之前，
        // 否则 driver_users/squad_members 永远全量返回、增量形同虚设）。
        if (hasValidSince) {
          const tsJ = Number(doc.updatedAt || doc.lastStatusUpdateTime || doc.locationTimestamp || doc.lastLocationTime || doc.createdAt || doc.timestamp || 0);
          if (!(tsJ > sinceMsJ)) return false;
        }
        // 2026-10-22 第六轮(P0-1)：身份一律以集合键为准（上方 map 已保证 doc.id=键，
        // 不再被文档内嵌 id 如 'app-<时间戳>' 覆盖）；手机号取 phone 字段、缺失才以键兜底。
        const docIdStr = String(doc.id || '').trim();
        const phoneStr = String(doc.phone || docIdStr || '').trim();
        const cleanPhone = phoneStr.replace(/\D/g, '').trim();
        const hasASuffix = docIdStr.toUpperCase().endsWith('A') || phoneStr.toUpperCase().endsWith('A');

        if (col === 'squad_applications') {
          // 第六轮：删除通用名规则（同 MySQL 分支，P0-1 主因）；保留 A/商户/开发者排除。
          if (hasASuffix || doc.isMerchant || doc.accountType === 'merchant') return false;
          if (cleanPhone === '15509601222') return false;
          return true;
        }

        if (col === 'online_applications') {
          if (cleanPhone === '15509601222') return true;
          if (hasASuffix || doc.isMerchant) return false;
          return true;
        }

        if (['merchant_accounts', 'merchant_users'].includes(col)) {
          // 第二十轮：与 MySQL 分支同口径（旧 JSON 分支只认 A 后缀，靠 isMerchant/
          // accountType/role 标记的商户在 JSON 模式下整批消失，两模式返回不同事实）。
          const docRoleJ = String(doc?.role || doc?.userRole || '');
          const isMerchantByRoleJ = (docRoleJ.includes('商户') || docRoleJ.includes('商家')) && !docRoleJ.includes('司机');
          if (!docIdStr.toUpperCase().endsWith('A') && !doc?.isMerchant && doc?.accountType !== 'merchant' && !isMerchantByRoleJ) return false;
          return true;
        }

        if (['squad_members', 'driver_users'].includes(col)) {
          if (cleanPhone === '15509601222') return true;
          if (hasASuffix) return false;
          // 第六轮(G-P2)：删除通用名整行隐藏（同 MySQL 分支）
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

      return res.json({ docs, list: docs, data: docs, watermark: listWatermark });
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

      // 2026-10-20 重建：成员/申请/职位状态集合收口——非开发者禁止经通用写接口改动，
      // 状态变更只走专用接口（approve/reject/remove/squad-apply/withdraw/set-role）。
      // 不再静默剥离后假报成功，直接 403 明确报错。
      if ((['squad_members', 'squad_applications', 'team_members'].includes(col) || (col === 'config' && docId === 'removed_squad_members')) && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '成员与申请状态只能通过专用接口变更', code: 'PROTECTED_COLLECTION' });
      }
      // 2026-10-20 重建：driver_users 的状态/角色字段同样收口，防借档案写角色再镜像提权
      if (col === 'driver_users' && !(req as any).isAdmin) { // 2026-10-21 第三轮(P1-2)：管理也不许经通用写给他人写状态字段（isBanned 可软封上级、role 可污染投影），状态只走专用接口
        const STATE_FIELDS = ['status', 'approvalStatus', 'role', 'userRole', 'squad_position', 'position', 'is_squad_member', 'inSquad', 'isBanned', 'onlineOrdersEnabled']; // 2026-10-22 第九轮：线上单开通资格只走审批接口，通用写剥离
        for (const f of STATE_FIELDS) {
          if (data && typeof data === 'object' && f in data) delete data[f];
        }
      }
      // 2026-10-23 第二十五轮：订单集合状态字段收口——订单状态只走业务接口（派单/抢单/
      // 取消/完单/转大厅），通用写一律剥离，防管理层/派单员 token 直写订单终态绕过全部
      // 状态机守卫。客户端现行代码零通用写订单状态（已全仓核实），剥离不影响现行流程；
      // set 的合并底稿会保留服务端现行状态值，剥离只是不许通用写改动它们。
      if (col === 'merchant_orders' || col === 'valet_orders' || col === 'orders') {
        const ORDER_STATE_FIELDS = ['status', 'statusCategory', 'isCancelled', 'in_hall', 'claimedDriverPhone', 'claimedDriverName', 'dispatchedDriverPhone', 'dispatchedDriverName', 'hallAt', 'declinedDriverPhones', 'timeoutDriverPhones'];
        for (const f of ORDER_STATE_FIELDS) {
          if (data && typeof data === 'object' && f in data) delete data[f];
        }
      }
      // M3修复：普通用户写 squad_members 时剥离敏感字段（防被开除司机自助"洗白"）
      // 只有开发者/城市老板/城市管理可写 status/approvalStatus/role/squad_position
      // 注(2026-10-22 第六轮)：上方 PROTECTED_COLLECTION 已对非开发者写 squad_members 先行 403，
      // 本块实际不可达；删除有牵连风险，按审计口径保留备查，不强求。
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
      // 2026-10-21 第四轮(P1-26)：online_applications 的 status/approvalStatus 此前可由司机本人经通用写
      // 自封 'approved'，客户端弹窗又直接读该字段判定「已通过」。非开发者只允许待审类取值，其余剥离；
      // 审批结论只能由开发者或专用接口写入（db/add 同步此口径）。
      if (col === 'online_applications' && !(req as any).isAdmin && data && typeof data === 'object') {
        for (const f of ['status', 'approvalStatus']) {
          if (f in data) {
            const stV = String((data as any)[f] || '').trim();
            if (!['待审核', '待审批', 'pending', '未提交', ''].includes(stV)) {
              console.warn(`[Auth] online_applications ${f} 自写已剥离(set): token手机=${(req as any).authPhone}, 值=${stV}`);
              delete (data as any)[f];
            }
          }
        }
      }

      // 2026-10-23 第十四轮：driver_locations 通用写坐标消毒（与 /api/driver/location 同口径）。
      // 非法坐标字段（非数字/越界）逐个剥离；有效对若为 (0,0) 无定位哨兵则整对剥离。
      // lat 在派单/附近读取时优先于 latitude，假坐标落库会顶掉真坐标。
      if (col === 'driver_locations' && data && typeof data === 'object') {
        for (const [f, mn, mx] of [['lat', -90, 90], ['latitude', -90, 90], ['lng', -180, 180], ['longitude', -180, 180]] as const) {
          const v = (data as any)[f];
          if (v !== undefined && !isValidCoordValue(v, mn, mx)) delete (data as any)[f];
        }
        const eLat = (data as any).lat !== undefined ? Number((data as any).lat) : ((data as any).latitude !== undefined ? Number((data as any).latitude) : undefined);
        const eLng = (data as any).lng !== undefined ? Number((data as any).lng) : ((data as any).longitude !== undefined ? Number((data as any).longitude) : undefined);
        if (eLat === 0 || eLng === 0) { delete (data as any).lat; delete (data as any).lng; delete (data as any).latitude; delete (data as any).longitude; }
        // 2026-10-23 第二十二轮：gpsValid 粘性根治（通用写通道，同 /api/driver/location 口径）：
        // 本次写带有效坐标即真实定位到达，gpsValid 置 true，防上线即时上报的 false 永久粘住。
        if (eLat !== undefined && eLng !== undefined && eLat !== 0 && eLng !== 0) (data as any).gpsValid = true;
      }
      // 2026-10-23 第二十三轮：squad_members.status 是成员资格事实，在线态值（idle/busy/
      // offline/online）绝不许经通用写落库——存量毒化文档正由此类跨域写产生（写者含旧版
      // 服务端路径与任何持管理员令牌的客户端），落库后派单会把司机当非成员淘汰。
      // 写在线态 status 时只剥离该字段，其余字段照常写。
      if (col === 'squad_members' && data && typeof data === 'object' && PRESENCE_STATUS_TOKENS.has(String((data as any).status || '').trim().toLowerCase())) {
        delete (data as any).status;
      }

      // 2026-10-23 第十六轮：removed 司机本人通用写不得复活在线状态。专用 location 接口
      // 对 removed 是删档+拦截，通用写此前无此闸——实测被移除者 db/set 自写 isOnline=true
      // 在 driver_users/driver_locations 双表均落库（其 App 正是走 dbProxy 通用写上报）。
      // 仅限本人写自己这两张表且值为 true 时强制置 false；管理员代写、其他字段不受影响。
      if ((col === 'driver_users' || col === 'driver_locations') && data && typeof data === 'object' && (data as any).isOnline === true) {
        const writerDigits = normalizeDriverPhoneUnified((req as any).authPhone);
        if (writerDigits && writerDigits === normalizeDriverPhoneUnified(docId) && writerDigits !== DEVELOPER_PHONE_SERVER) {
          const removedSetW = await getRemovedSetCached5s();
          if (removedSetW.has(writerDigits)) (data as any).isOnline = false;
        }
      }

      // 1. If explicitly approving, automatically unblacklist the driver
      // 2026-10-20修复：申请（待审核）不解黑名单，只有审批通过才解，防止被拉黑司机自助洗白
      const isExplicitApproval = isApprovedMemberStatus(data?.status) || isApprovedMemberStatus(data?.approvalStatus);

      // 2026-10-22 第六轮善后：原「写已通过成员文档自动解黑」已删除——removed 名单是成员资格的
      // 权威闸门，只能由 /api/squad-member/approve 在审批时显式解除；通用写接口写一份残留的
      // 已通过文档不得静默解黑（否则双写分叉残留一同步回来，被移除者即被洗白、还会被批量充值）。
      // 文档本身照常写入，但只要还在 removed 名单内，统一口径下就不算成员、不生效。

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
          return res.status(409).json({ success: false, id: docId, dropped: true, code: 'REMOVED_DRIVER', error: '该司机已被移出小队，请先通过审批接口恢复成员资格' });
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
          // 2026-10-21 第四轮(P1-1)：与 db/update 的 M4 口径对齐——MySQL 是权威源，写失败直接 500，
          // 不再吞错后只写 JSON 还报成功（客户端以为存上了、权威源其实没变，刷新即还原）。
          return res.status(500).json({ success: false, error: '数据库写入失败，请重试' });
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      // 2026-10-21 第四轮(P1-1)：MySQL 模式下 finalData 已以 MySQL 文档为底合并过一次，
      // JSON 侧直接落同一份，不再以 JSON 旧底稿二次合并（双边独立合并只会越写越分叉）。
      if (merge && dbData[col][docId] && !(isMySQLEnabled && mysqlPool)) {
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
            status: finalData.status || existingUser.status || '未加入小队',
            is_squad_member: (col === 'squad_members' && isApprovedMemberStatus(effectiveMemberStatus(finalData))) ? 1 : (existingUser.is_squad_member ?? 0),
            city: finalData.city || existingUser.city || '银川市',
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== undefined ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: existingUser.onlineOrdersEnabled === true, // 2026-10-22 第九轮(P1)：只保留既有审批结果，镜像不透传、不再默认置真（旧默认 true 让提交申请即自置开通）
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
            // 2026-10-20根治：镜像底稿必须以 MySQL 现行文档为准。
            // 原逻辑只读 local_db.json，而 /api/squad-apply 等专用接口只写 MySQL 不同步 JSON，
            // JSON 里残留的是 /api/driver/name 建的"只有姓名的档案壳"，镜像一触发就把
            // 带 status/phone 的好申请覆盖成无 status 的档案（审核中闪烁/申请丢失根因）。
            let currentM = dbData[mCol] ? dbData[mCol][cleanDriverPhone] : undefined;
            if (isMySQLEnabled && mysqlPool) {
              try {
                const [mRows]: any = await mysqlPool.query(
                  'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                  [mCol, cleanDriverPhone]
                );
                if (mRows && mRows.length > 0) {
                  currentM = typeof mRows[0].data === 'string' ? JSON.parse(mRows[0].data) : mRows[0].data;
                }
              } catch (_) {}
            }
            if (currentM) {
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== undefined) updatedM.vipExpiry = finalData.vipExpiry;
              // 2026-10-20 重建：driver_users 的 role 不再镜像到成员/申请表（防借档案改角色提权）。
              // 角色变更只走 /api/squad-member/set-role 与 /api/admin/update-driver-role。
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

      // 2026-10-20 重建：成员/申请/职位状态集合收口——非开发者禁止经通用写接口改动，
      // 状态变更只走专用接口（approve/reject/remove/squad-apply/withdraw/set-role）。
      // 不再静默剥离后假报成功，直接 403 明确报错。
      if ((['squad_members', 'squad_applications', 'team_members'].includes(col) || (col === 'config' && docId === 'removed_squad_members')) && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '成员与申请状态只能通过专用接口变更', code: 'PROTECTED_COLLECTION' });
      }
      // 2026-10-20 重建：driver_users 的状态/角色字段同样收口，防借档案写角色再镜像提权
      if (col === 'driver_users' && !(req as any).isAdmin) { // 2026-10-21 第三轮(P1-2)：管理也不许经通用写给他人写状态字段（isBanned 可软封上级、role 可污染投影），状态只走专用接口
        const STATE_FIELDS = ['status', 'approvalStatus', 'role', 'userRole', 'squad_position', 'position', 'is_squad_member', 'inSquad', 'isBanned', 'onlineOrdersEnabled']; // 2026-10-22 第九轮：线上单开通资格只走审批接口，通用写剥离
        for (const f of STATE_FIELDS) {
          if (data && typeof data === 'object' && f in data) delete data[f];
        }
      }
      // 2026-10-23 第二十五轮：订单集合状态字段收口——订单状态只走业务接口（派单/抢单/
      // 取消/完单/转大厅），通用写一律剥离，防管理层/派单员 token 直写订单终态绕过全部
      // 状态机守卫。客户端现行代码零通用写订单状态（已全仓核实），剥离不影响现行流程；
      // set 的合并底稿会保留服务端现行状态值，剥离只是不许通用写改动它们。
      if (col === 'merchant_orders' || col === 'valet_orders' || col === 'orders') {
        const ORDER_STATE_FIELDS = ['status', 'statusCategory', 'isCancelled', 'in_hall', 'claimedDriverPhone', 'claimedDriverName', 'dispatchedDriverPhone', 'dispatchedDriverName', 'hallAt', 'declinedDriverPhones', 'timeoutDriverPhones'];
        for (const f of ORDER_STATE_FIELDS) {
          if (data && typeof data === 'object' && f in data) delete data[f];
        }
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
      // 2026-10-21 第四轮(P1-26)：与 /api/db/set 同口径——online_applications 的审批结论不许本人自写。
      if (col === 'online_applications' && !(req as any).isAdmin && data && typeof data === 'object') {
        for (const f of ['status', 'approvalStatus']) {
          if (f in data) {
            const stV = String((data as any)[f] || '').trim();
            if (!['待审核', '待审批', 'pending', '未提交', ''].includes(stV)) {
              console.warn(`[Auth] online_applications ${f} 自写已剥离(update): token手机=${(req as any).authPhone}, 值=${stV}`);
              delete (data as any)[f];
            }
          }
        }
      }

      // 2026-10-23 第十四轮：driver_locations 通用写坐标消毒（同 /api/db/set 口径）。
      if (col === 'driver_locations' && data && typeof data === 'object') {
        for (const [f, mn, mx] of [['lat', -90, 90], ['latitude', -90, 90], ['lng', -180, 180], ['longitude', -180, 180]] as const) {
          const v = (data as any)[f];
          if (v !== undefined && !isValidCoordValue(v, mn, mx)) delete (data as any)[f];
        }
        const eLat = (data as any).lat !== undefined ? Number((data as any).lat) : ((data as any).latitude !== undefined ? Number((data as any).latitude) : undefined);
        const eLng = (data as any).lng !== undefined ? Number((data as any).lng) : ((data as any).longitude !== undefined ? Number((data as any).longitude) : undefined);
        if (eLat === 0 || eLng === 0) { delete (data as any).lat; delete (data as any).lng; delete (data as any).latitude; delete (data as any).longitude; }
        // 2026-10-23 第二十二轮：gpsValid 粘性根治（通用写通道，同 /api/driver/location 口径）：
        // 本次写带有效坐标即真实定位到达，gpsValid 置 true，防上线即时上报的 false 永久粘住。
        if (eLat !== undefined && eLng !== undefined && eLat !== 0 && eLng !== 0) (data as any).gpsValid = true;
      }
      // 2026-10-23 第二十三轮：squad_members.status 是成员资格事实，在线态值（idle/busy/
      // offline/online）绝不许经通用写落库——存量毒化文档正由此类跨域写产生（写者含旧版
      // 服务端路径与任何持管理员令牌的客户端），落库后派单会把司机当非成员淘汰。
      // 写在线态 status 时只剥离该字段，其余字段照常写。
      if (col === 'squad_members' && data && typeof data === 'object' && PRESENCE_STATUS_TOKENS.has(String((data as any).status || '').trim().toLowerCase())) {
        delete (data as any).status;
      }

      // 2026-10-23 第十六轮：removed 司机本人通用写不得复活在线状态（同 /api/db/set 口径）。
      if ((col === 'driver_users' || col === 'driver_locations') && data && typeof data === 'object' && (data as any).isOnline === true) {
        const writerDigits = normalizeDriverPhoneUnified((req as any).authPhone);
        if (writerDigits && writerDigits === normalizeDriverPhoneUnified(docId) && writerDigits !== DEVELOPER_PHONE_SERVER) {
          const removedSetW = await getRemovedSetCached5s();
          if (removedSetW.has(writerDigits)) (data as any).isOnline = false;
        }
      }

      // 1. If explicitly approving, automatically unblacklist the driver
      // 2026-10-20修复：申请（待审核）不解黑名单，只有审批通过才解，防止被拉黑司机自助洗白
      const isExplicitApproval = isApprovedMemberStatus(data?.status) || isApprovedMemberStatus(data?.approvalStatus);

      // 2026-10-22 第六轮善后：原「写已通过成员文档自动解黑」已删除——removed 名单是成员资格的
      // 权威闸门，只能由 /api/squad-member/approve 在审批时显式解除；通用写接口写一份残留的
      // 已通过文档不得静默解黑（否则双写分叉残留一同步回来，被移除者即被洗白、还会被批量充值）。
      // 文档本身照常写入，但只要还在 removed 名单内，统一口径下就不算成员、不生效。

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
          return res.status(409).json({ success: false, id: docId, dropped: true, code: 'REMOVED_DRIVER', error: '该司机已被移出小队，请先通过审批接口恢复成员资格' });
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

      if (!(isMySQLEnabled && mysqlPool)) {
        // 2026-10-21 第四轮(P1-3)：JSON 模式下 update 此前是整档替换——updateDoc 只传部分字段
        // 会把文档其余字段整档抹掉。与 db/set 的合并语义对齐：以 JSON 现有文档为底合并一次。
        const prevJsonDoc = readLocalJsonDb()?.[col]?.[docId];
        if (prevJsonDoc) finalData = { ...prevJsonDoc, ...data };
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
            status: finalData.status || existingUser.status || '未加入小队',
            is_squad_member: (col === 'squad_members' && isApprovedMemberStatus(effectiveMemberStatus(finalData))) ? 1 : (existingUser.is_squad_member ?? 0),
            city: finalData.city || existingUser.city || '银川市',
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== undefined ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: existingUser.onlineOrdersEnabled === true, // 2026-10-22 第九轮(P1)：只保留既有审批结果，镜像不透传、不再默认置真（旧默认 true 让提交申请即自置开通）
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
            // 2026-10-20根治（同 /api/db/set）：镜像底稿以 MySQL 现行文档为准，
            // 防止 JSON 残留的"姓名壳"覆盖掉带 status/phone 的好申请。
            let currentM = dbData[mCol] ? dbData[mCol][cleanDriverPhone] : undefined;
            if (isMySQLEnabled && mysqlPool) {
              try {
                const [mRows]: any = await mysqlPool.query(
                  'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                  [mCol, cleanDriverPhone]
                );
                if (mRows && mRows.length > 0) {
                  currentM = typeof mRows[0].data === 'string' ? JSON.parse(mRows[0].data) : mRows[0].data;
                }
              } catch (_) {}
            }
            if (currentM) {
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
      if (hasMerchantASuffix(req.body.phone) || hasMerchantASuffix(req.body.phoneNumber)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不能修改司机VIP' });
      }
      const rawVip = String(req.body.vipExpiry || '').trim();
      // 2026-10-22 第九轮：vipExpiry 缺参/空串直接 400——旧口径把空值归一成「待开通」
      // 并返回成功，任何漏传参的调用都会把司机 VIP 静默清零（假成功型隐患）。
      // 管理后台始终显式传日期或「待开通」，不受影响。
      if (req.body.vipExpiry === undefined || rawVip === '') {
        return res.status(400).json({ success: false, error: '缺少 vipExpiry 参数' });
      }

      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: '请输入有效的11位手机号码' });
      }

      let vipExpiry = rawVip;
      if (!vipExpiry || vipExpiry === '0' || vipExpiry === '0天' || vipExpiry === '待激活' || vipExpiry === '未激活' || vipExpiry === '待开通' || vipExpiry === '未开通' || vipExpiry === '已到期' || vipExpiry === '已过期') {
        vipExpiry = '待开通';
      } else if (vipExpiry === '永久' || vipExpiry === '永久有效' || vipExpiry === 'permanent' || vipExpiry === '终身') {
        vipExpiry = '永久有效';
      }
      // 2026-10-23 第十四轮：别名之外必须是真实存在的 YYYY-MM-DD 日历日期，否则 400。
      // 旧口径对任意非空串照单全收（实测 "abc"/12345 均被写入双表），垃圾值会污染
      // App 会员显示与 VIP 校验（解析失败按过期处理），且写入成功假象掩盖调用方错误。
      if (vipExpiry !== '待开通' && vipExpiry !== '永久有效') {
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vipExpiry);
        const dt = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : null;
        if (!dm || !dt || dt.getFullYear() !== Number(dm[1]) || dt.getMonth() !== Number(dm[2]) - 1 || dt.getDate() !== Number(dm[3])) {
          return res.status(400).json({ success: false, error: 'vipExpiry 格式无效：须为 YYYY-MM-DD 日期、永久有效或待开通' });
        }
      }

      const dbData = readLocalJsonDb();
      // 2026-10-22 第六轮：去掉 squad_applications——有效期不写申请表（与 H5 口径对齐，防壳复活）
      const targetCols = ['driver_users', 'squad_members'];
      // 2026-10-20 重构(H5)：existing-only——只更新已存在的文档，不再给不存在的号造无 status 的成员/申请壳
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

      if (!expiryWroteAny) {
        return res.status(404).json({ success: false, error: '该司机不存在' });
      }
      writeLocalJsonDb(dbData, true);

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
      if (hasMerchantASuffix(req.body.phone) || hasMerchantASuffix(req.body.phoneNumber)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不能充值接单授权' });
      }
      const inputName = String(req.body.name || '').trim();
      // 2026-10-16晚：支持 permanent=true 设为永久。永久直接写'永久有效'，跳过天数校验。
      const wantPermanent = (req.body as any).permanent === true;
      // P0(2026-10-16)：天数=0 表示屏蔽接单（管理后台文案承诺的行为），不再当非法输入拦掉；
      // 但缺参数/空字符串必须拒绝，防止误触清空授权
      const rawDays: any = (req.body as any).days;
      const days = Math.floor(Number(rawDays));
      if (!wantPermanent) {
        if (rawDays === undefined || rawDays === null || typeof rawDays === 'boolean' || typeof rawDays === 'object' || String(rawDays).trim() === '' || isNaN(days) || days < 0 || days > 3650) {
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
      // 2026-10-20 重构(H5)：目标必须真实存在，不给不存在的号建壳
      const licGateDoc = (await Promise.resolve(readCanonicalDocument('driver_users', targetPhone))) || (await Promise.resolve(readCanonicalDocument('squad_members', targetPhone)));
      if (!licGateDoc) {
        return res.status(404).json({ success: false, error: '未找到该司机' });
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
      // 2026-10-20 重构(H5)：授权只写 driver_users/squad_members 两处权威存储，不再给申请表写授权壳
      const targetCols = ['driver_users', 'squad_members'];
      const now = new Date().toISOString();
      if (isMySQLEnabled && mysqlPool) {
        for (const col of targetCols) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, targetPhone]);
          if (!rows || rows.length === 0) continue; // 2026-10-20 重构(H5)：该集合无此人文档则跳过，不建壳
          const existing: any = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
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
        if (!newExpiry) newExpiry = colExpiries['squad_members'] || colExpiries['driver_users'] || '';
        // P0(2026-10-16)：MySQL 写入后同步双写本地 JSON。/api/db/get 在 MySQL 抖动时会回退读本地，
        // 若本地是旧值会导致 App/后台显示跳变（已到期↔2天）。双写保证回退数据源永远新鲜。
        // 每集合用自己的值（与 MySQL 一致），不再复用单一 newExpiry。
        try {
          const dbData = readLocalJsonDb();
          for (const col of targetCols) {
            if (!dbData[col] || !dbData[col][targetPhone]) continue; // 只双写已存在的本地文档，不建壳
            const existingLocal = dbData[col][targetPhone];
            dbData[col][targetPhone] = { ...existingLocal, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiries[col] || newExpiry, updatedAt: now };
          }
          writeLocalJsonDb(dbData);
        } catch (dualErr: any) {
          console.error('[Recharge License] 本地JSON双写失败（MySQL已成功）:', dualErr?.message);
        }
      } else {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (!dbData[col] || !dbData[col][targetPhone]) continue; // existing-only，不建壳
          const existing = dbData[col][targetPhone];
          // P0(2026-10-16)：每集合单独算（与 MySQL 分支同口径）
          const colExpiryLocal = calcAbsoluteExpiry();
          if (col === 'driver_users') newExpiry = colExpiryLocal;
          dbData[col][targetPhone] = { ...existing, phone: targetPhone, phoneNumber: targetPhone, licenseExpiry: colExpiryLocal, updatedAt: now };
        }
        if (!newExpiry) {
          const sqLic = dbData['squad_members']?.[targetPhone]?.licenseExpiry;
          if (sqLic) newExpiry = String(sqLic);
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
      if (rawDays === undefined || rawDays === null || typeof rawDays === 'boolean' || typeof rawDays === 'object' || String(rawDays).trim() === '' || isNaN(days) || days < 0 || days > 3650) {
        return res.status(400).json({ success: false, error: '天数必须在0-3650之间（0=屏蔽接单）' });
      }
      // P1(2026-10-16晚)：改为绝对值设置（与单充一致）。填几天就是几天，不再累加。
      const calcExpiry = (): string => {
        if (days === 0) return '已到期';
        const base = new Date();
        base.setDate(base.getDate() + days);
        return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
      };
      // 2026-10-20 重构(H5)：授权只写 driver_users/squad_members 两处权威存储，不再给申请表写授权壳
      const targetCols = ['driver_users', 'squad_members'];
      const now = new Date().toISOString();
      let count = 0;
      // 2026-10-22 第六轮：批量授权加 removed 排除，status 判定换统一值集 isApprovedMemberStatus（含 trim）。
      // 旧实现无 removed 检查且比对不 trim，被移除者可被批量重新点亮接单授权。
      const removedSetLicBatch = new Set<string>(await readRemovedPhonesMergedUnified().catch(() => [] as string[]));
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
            // 只给已通过的成员充值（第六轮：统一值集 + removed 排除）
            if (!isApprovedMemberStatus(effectiveMemberStatus(d))) continue;
            if (phone !== DEVELOPER_PHONE_SERVER && removedSetLicBatch.has(phone)) continue;
          } catch (_) { continue; }
          const newExp = days === 0 ? '已到期' : calcExpiry();
          for (const col of targetCols) {
            const [erows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', [col, phone]);
            if (!erows || erows.length === 0) continue; // existing-only，不建壳
            const ex: any = typeof erows[0].data === 'string' ? JSON.parse(erows[0].data) : erows[0].data;
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
              if (!dbData[col] || !dbData[col][phone]) continue;
              const ex = dbData[col][phone];
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
          if (!isApprovedMemberStatus(effectiveMemberStatus(d))) continue;
          if (p !== DEVELOPER_PHONE_SERVER && removedSetLicBatch.has(p)) continue;
          const newExp = days === 0 ? '已到期' : calcExpiry();
          for (const col of targetCols) {
            if (!dbData[col] || !dbData[col][p]) continue;
            const ex = dbData[col][p];
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
      // 2026-10-20 重构(H5)：目标必须真实存在且逐集合 existing-only，不再给不存在的号批量建壳
      const roleGateDoc = (await Promise.resolve(readCanonicalDocument('driver_users', phone))) || (await Promise.resolve(readCanonicalDocument('squad_members', phone)));
      if (!roleGateDoc) {
        return res.status(404).json({ success: false, error: '该司机不存在' });
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
          ...(dbData.team_members[phone] || {}),
          phone,
          name: dbData.squad_members?.[phone]?.name || dbData.driver_users?.[phone]?.name || dbData.team_members[phone]?.name || '',
          role: validRole,
          squad_position: squadPositionCodeFromRole(validRole),
          status: '已通过',
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

      console.log(`[Admin Driver Role Updated] Phone: ${phone} -> role: ${validRole}`);
      await logAdminOperation('update-driver-role', String((req as any).authPhone || ''), phone, `角色设为${validRole}`, req).catch(() => {});
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
      // 2026-10-20 重构：显式传 0 不再被 || 50 吞成 50；缺参才用默认 50，非法值直接拒绝
      const daysRaw: any = (req.body as any)?.days;
      const daysCount = daysRaw === undefined || daysRaw === null || String(daysRaw).trim() === '' ? 50 : Math.floor(Number(daysRaw));
      if (isNaN(daysCount) || daysCount < 0 || daysCount > 3650) {
        return res.status(400).json({ success: false, error: '天数必须在0-3650之间' });
      }
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
      // 2026-10-20 重构(H5)：批量充值不再写 squad_applications——成员的申请在审批时已被消费，写回等于复活已通过申请
      const targetCols = ['driver_users', 'squad_members'];

      // P0(2026-10-15)：只给已通过的小队成员充值，防误批待审申请人
      // 2026-10-22 第六轮(S-P1)：已通过集合改与 getUnifiedMembership 完全同口径——成员状态文档
      // MySQL 优先、须 status 已通过、排除 removed 双源合并名单。旧实现 JSON/MySQL 任一说已通过
      // 即算且零 removed 检查：MySQL 成员行已删而 JSON 残留已通过文档时，一次批量充值即整档回写复活。
      const approvedPhones = new Set<string>();
      const skippedPhones: string[] = [];
      for (const phone of Array.from(allPhones)) {
        if (phone === exclude) continue;
        let mship: any = null;
        try { mship = await getUnifiedMembership(phone); } catch (_) {}
        if (mship && mship.isMember && !mship.isRemoved) {
          approvedPhones.add(phone);
        }
      }

      for (const phone of Array.from(approvedPhones)) {
        // 第六轮(S-P1)：回写前逐个复核统一口径；非成员/被移除者跳过并计入 skipped 返回，
        // 绝不再把 status:'已通过' 整档硬盖给口径外的人。
        let recheck: any = null;
        try { recheck = await getUnifiedMembership(phone); } catch (_) {}
        if (!recheck || !recheck.isMember || recheck.isRemoved) {
          skippedPhones.push(phone);
          continue;
        }
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
          if (isMySQLEnabled && mysqlPool) { // 2026-10-21 第四轮(P1-5)：原条件只在 JSON 缺 vipExpiry 时才读 MySQL，陈旧 JSON 基数会累加后覆盖 MySQL 权威值；改恒以 MySQL 文档为底（无行才用 JSON）
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

      try { await logAdminOperation('batch-recharge-vip', String((req as any).authPhone || ''), 'squad', `批量VIP充值，失败 ${failedPhones.length} 人`, req); } catch (_) {}
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

      // 2026-10-20 重建：状态集合禁止通用删除（撤回走 withdraw、移出走 remove、彻底删除走开发者专用流程）
      if (['squad_members', 'squad_applications', 'team_members'].includes(col) && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '成员与申请状态只能通过专用接口变更', code: 'PROTECTED_COLLECTION' });
      }

      // 2026-10-21 第三轮(P0-1)：driver_users 的 MySQL 删除带 hardDelete 时会级联删
      // squad_members/squad_applications/online_applications，等于绕过 /api/squad-member/remove
      // 的等级校验且不留 removed 痕迹与审计日志。非开发者只能删本人文档，且本人不得
      // hardDelete（级联仅开发者可用）；删他人档案一律走 remove 专用接口。
      if (['driver_users', 'online_applications'].includes(col) && !(req as any).isAdmin) {
        const requesterPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
        const cleanDocPhone = docId.replace(/\D/g, '').trim();
        if (cleanDocPhone !== requesterPhone) {
          return res.status(403).json({ success: false, error: '删除他人档案请走小队成员移除流程' });
        }
        if (req.body.hardDelete === true || req.body.hardDelete === 'true') {
          return res.status(403).json({ success: false, error: '彻底删除账号请联系开发者处理' });
        }
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
          // 第二十轮：MySQL 删除失败必须报 500——旧口径吞错后继续删 JSON 并返回成功，
          // 权威源与镜像当场分叉（MySQL 里人还在、JSON 已删、调用方以为删成功）。
          console.error('[DB Proxy DELETE MySQL Error]:', mysqlErr);
          return res.status(500).json({ success: false, error: 'MySQL 删除失败: ' + (mysqlErr?.message || 'unknown') });
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
    // 2026-10-21 第二轮修复(P0)：清表是开发者级操作。此前处理器自身无任何校验，
    // 而 requireDbAuth 对管理(MEMBER_COLS)/派单员又有提前放行，清表可绕过 PROTECTED_COLLECTION
    // 把 squad_members 等状态表整表清空且无审计——在此补与 clear-all 同口径的 isAdmin 门。
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
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
          return res.status(500).json({ success: false, error: 'MySQL 清表失败: ' + (mysqlErr?.message || 'unknown') });
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

      try { await logAdminOperation('clear-collection', String((req as any).authPhone || ''), col, `整表清空集合 ${col}`, req); } catch (_) {}
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
      // 2026-10-24 第四十六轮（用户拍板修）：MySQL 删除失败不再吞——旧实现只记日志仍报
      // 「已彻底清除」，与 P1-13「不许假报」口径相悖。失败时本地镜像与时间戳兜底照常
      // 完成（列表不会回显旧单），但接口如实回 500，App 端会弹「服务器删除失败」提示。
      let mysqlClearFailed = false;

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
          mysqlClearFailed = true;
          console.error('[MySQL Clear-All Orders Error]:', mysqlErr);
        }
        // 2026-10-21 第二轮修复(P1)：与 JSON 分支对齐，MySQL 模式下也重置忙碌标记（只写 isBusy，不碰 status；
        // 旧实现 MySQL 分支完全不重置，生产点此按钮忙碌状态清不掉）。
        try {
          for (const busyCol of ['driver_users', 'driver_locations']) {
            const [bRows]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?', [busyCol]);
            for (const bRow of (bRows || [])) {
              try {
                const bData = typeof bRow.data === 'string' ? JSON.parse(bRow.data) : bRow.data;
                if (bData && bData.isBusy) {
                  bData.isBusy = false;
                  await mysqlPool.query(
                    'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                    [JSON.stringify(bData), busyCol, bRow.doc_id]);
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      const dbData = readLocalJsonDb();
      orderCollections.forEach((c) => {
        dbData[c] = {};
      });

      if (!dbData.config) dbData.config = {};
      dbData.config['merchant_orders_cleared'] = { clearedAt: nowTs };

      // 重置忙碌标记（只清 isBusy）。2026-10-21 第二轮修复(P1)：旧逻辑顺带把三表 status 写成 'idle'，
      // squad_members/driver_users 的 status 是成员资格与档案投影，写 idle 等于把全员打成非成员；
      // 与 MySQL 分支对齐——只重置 driver_users/driver_locations 的 isBusy，绝不碰任何 status。
      if (dbData['driver_users']) {
        Object.keys(dbData['driver_users']).forEach((p) => {
          if (dbData['driver_users'][p]) {
            dbData['driver_users'][p].isBusy = false;
          }
        });
      }
      if (dbData['driver_locations']) {
        Object.keys(dbData['driver_locations']).forEach((p) => {
          if (dbData['driver_locations'][p]) {
            dbData['driver_locations'][p].isBusy = false;
          }
        });
      }

      writeLocalJsonDb(dbData);
      console.log('✓ [阿里云本地数据库] 已彻底清除所有订单记录，本地与服务器不再保存所有订单记录');
      try { await logAdminOperation('clear-all-orders', String((req as any).authPhone || ''), 'merchant_orders', '一键清空全部订单记录', req); } catch (_) {}
      if (mysqlClearFailed) {
        return res.status(500).json({ success: false, clearedAt: nowTs, error: 'MySQL 订单表删除失败：本地镜像已清空、时间戳兜底已生效（旧单不会再显示），请稍后重试清空或检查数据库' });
      }
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
          // 2026-10-21 第四轮(P2-5)：squad_members 是成员事实表——无文档者不许被下线动作建成
          // 「无 status 的成员壳」（这类壳曾被成员名单组装误盖成已通过）。其余两表是档案/位置投影，可照常建档。
          if (col === 'squad_members' && !(rows && rows.length > 0)) continue;
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
      if (col === 'squad_members' && !dbData[col][cleanPhone]) return; // 同 MySQL 分支：不给非成员建成员壳
      const prev = dbData[col][cleanPhone] || {};
      dbData[col][cleanPhone] = { ...prev, ...offlinePayload };
    });
    // 2026-10-24 第四十四轮（3000 人压测挖出）：原为默认同步写——05:59 守护批量下线
    // 时每名司机一次全库 stringify+同步落盘（实验室 3.3MB 库约 65ms/次），3000 人
    // 一轮约 200 秒把事件循环钉死、全站无响应。改脏标异步刷盘（5 秒定时器落盘，
    // 与 MySQL 模式 daacc5da 的取舍一致）：内存状态即时生效，崩溃最多丢 5 秒镜像
    // 增量，下线状态由守护/看门狗下一轮自动重演，不丢业务事实。
    writeLocalJsonDb(dbData, false);
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
      const isBusy = parseStrictBool(req.body.isBusy) === true;
      const status = isBusy ? 'busy' : 'idle';
      const currentView = req.body.currentView || (isBusy ? 'create_order' : 'home');
      const timestamp = req.body.timestamp || Date.now();

      // 2026-10-20 重构(P0)：行程忙闲只写 isBusy。status 是成员资格事实(squad_members)与入队投影(driver_users)，
      // 写 busy/idle 进去会把司机做完一单就冲成非成员——忙闲改只存 driver_locations/driver_users 的 isBusy。
      const patch: any = {
        currentView,
        lastStatusUpdateTime: timestamp,
        lastUpdatedTime: new Date().toISOString()
      };
      // 2026-10-22 第七轮收尾：未带 isBusy 的调用不许顺带清忙碌（与 /api/driver/location 第四轮守卫对齐）。
      // 报单心跳每 15 秒调本接口且不带 isBusy，旧写法会周期性把行程忙碌冲回 false。
      if ((req.body as any).isBusy !== undefined) {
        patch.isBusy = isBusy;
      }

      // 2026-10-22 第七轮：报单页占用心跳。客户端停留在报单页时周期带 isReporting=true 调用，
      // 返回首页带 isReporting=false。服务端只存事实（标记+时间戳，随上方 patch 同步写
      // driver_locations 与 driver_users 双表），占用与否由读取方按 45 秒新鲜度计算
      // （见 occupancyOf）——不写 isBusy，不会触发 claim 忙碌守卫自锁（2026-10-17 旧雷）。
      // 不带 isReporting 的旧调用行为完全不变；isReporting=false 时 reportingAt 置 0 表示心跳停止。
      if (req.body.isReporting !== undefined) {
        const isReporting = parseStrictBool(req.body.isReporting) === true;
        patch.isReporting = isReporting;
        patch.reportingAt = isReporting ? Date.now() : 0;
      }

      const dbData = readLocalJsonDb();
      ['driver_users', 'driver_locations'].forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          // 2026-10-23 第二十五轮：更新改走 JSON_MERGE_PATCH 只补 patch 字段。旧实现把「JSON
          // 镜像底稿+patch」整档覆盖 MySQL——镜像一旦并发丢更新，下一次心跳就把陈旧字段回灌
          // 进 MySQL 权威源。插入新文档时仍写整档底稿。
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)',
            ['driver_locations', phone, JSON.stringify({ ...(dbData.driver_locations?.[phone] || {}), ...patch, phone }), JSON.stringify({ ...patch, phone })]
          );
          // 2026-10-21 第四轮(P2-8)：MySQL 分支此前只写 driver_locations，driver_users.isBusy 长期陈旧；
          // JSON 分支两表都写，此处补齐同口径。
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)',
            ['driver_users', phone, JSON.stringify({ ...(dbData.driver_users?.[phone] || {}), ...patch, phone }), JSON.stringify({ ...patch, phone })]
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
  // 2026-10-23 第十四轮：坐标值合法性（数字或非空数字字符串、有限、在范围内）
  function isValidCoordValue(v: any, min: number, max: number): boolean {
    if (typeof v !== 'number' && typeof v !== 'string') return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    const n = Number(v);
    return isFinite(n) && n >= min && n <= max;
  }

  app.post('/api/driver/location', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      // 2026-10-23 第十四轮：坐标合法性校验（先验原始值、再转数）。旧口径先 Number() 再只挡
      // NaN——null 被转成 0 落库、999 越界值照收，而 lat 在派单/附近读取时优先于 latitude，
      // 假坐标会顶掉真坐标。现口径：原始值必须是合法数字（isValidCoordValue，null/对象/空串
      // 一律非法）、成对出现、任一分量为精确 0 视为无定位哨兵（银川司机纬度≈38/经度≈106，
      // 不可能为 0）→ 整对不落库，心跳其余字段照常处理，响应带 coordsIgnored 标记。
      let lat: number | undefined = undefined;
      let lng: number | undefined = undefined;
      let coordsIgnored = false;
      // 2026-10-23 第十八轮：兼容 latitude/longitude 别名字段（Firestore 风格与部分旧端
      // 只传别名时，旧实现静默丢弃坐标——接口报成功、司机却永远派不到单；附近页读别名
      // 能看见人、派单看不见，跨系统口径分叉）。lat/lng 优先，别名兜底，校验口径不变。
      const rawLat = req.body.lat !== undefined ? req.body.lat : req.body.latitude;
      const rawLng = req.body.lng !== undefined ? req.body.lng : req.body.longitude;
      if (rawLat !== undefined || rawLng !== undefined) {
        if (isValidCoordValue(rawLat, -90, 90) && isValidCoordValue(rawLng, -180, 180) && Number(rawLat) !== 0 && Number(rawLng) !== 0) {
          lat = Number(rawLat);
          lng = Number(rawLng);
        } else {
          coordsIgnored = true;
        }
      }
      const isOnline = parseStrictBool(req.body.isOnline);
      const isBusy = parseStrictBool(req.body.isBusy);
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
      // 2026-10-21 第四轮：body 未带 isBusy 时不许把默认 false 写进 patch——行程中司机的忙碌状态
      // 会被不带该字段的位置上报冲掉（派单过滤随即失效）。
      if (isBusy === undefined) delete (patch as any).isBusy;
      if (driverName && !isGenericDriverName(driverName, phone)) {
        patch.driverName = driverName;
        patch.name = driverName;
      }
      if (req.body.city) patch.city = req.body.city;
      if (req.body.version) patch.version = req.body.version;
      if (req.body.appVersion) patch.appVersion = req.body.appVersion;
      // 2026-10-24 第四十二轮续修1：透传页面/上报来源字段。此前这三个字段只有客户端经
      // dbProxy 双写 setDoc 才落库；本轮客户端改为只走 REST 单通道（见 powerAndLocationManager），
      // 服务端在此补齐承接，保持 driver_users/driver_locations 字段口径不缩水。
      if (typeof req.body.currentView === 'string') patch.currentView = req.body.currentView;
      if (req.body.isInReportView !== undefined) patch.isInReportView = parseStrictBool(req.body.isInReportView);
      if (typeof req.body.lastUpdatedBy === 'string') patch.lastUpdatedBy = req.body.lastUpdatedBy;
      if (todayOrders !== undefined && !isNaN(todayOrders)) patch.todayOrders = todayOrders;
      if (lat !== undefined && !isNaN(lat)) patch.lat = lat;
      if (lng !== undefined && !isNaN(lng)) patch.lng = lng;
      // 第十八轮：落库时双格式同写（lat/lng 与 latitude/longitude），防只读其一的消费端拿到旧值
      if (lat !== undefined && !isNaN(lat)) patch.latitude = lat;
      if (lng !== undefined && !isNaN(lng)) patch.longitude = lng;
      // 2026-10-11：记录GPS有效性（滑动上线无GPS时上报，派单跳过无坐标司机）
      if (req.body.gpsValid !== undefined) patch.gpsValid = parseStrictBool(req.body.gpsValid);
      // 2026-10-23 第二十二轮：gpsValid 粘性根治——本次上报带有效坐标即真实 GPS 到达，
      // gpsValid 必须随之置 true。旧口径下该字段只有「上线即时上报」会写（无 GPS 时写 false），
      // 持续定位上报从不带此字段，false 一旦落库永不清除：司机 GPS 明明正常，也被派单以
      // 「GPS无效标记」永久跳过（2026-10-23 开发者实测：80 米内、唯一在线持证队员，订单不
      // 弹窗直进大厅）。无坐标的上报仍按显式 gpsValid 走，无 GPS 时旧坐标不参与派单的
      // 兜底语义（H-G2）不变。
      if (patch.lat !== undefined && patch.lng !== undefined && patch.lat !== 0 && patch.lng !== 0 && Math.abs(patch.lat) <= 90 && Math.abs(patch.lng) <= 180) patch.gpsValid = true;
      if (isOnline !== undefined) {
        patch.isOnline = isOnline;
        if (isOnline) {
          // a1-a5修复：恢复上线时清除看门狗踢出标记，否则标记永久残留
          patch.kickedOfflineAt = 0;
          patch.kickReason = '';
        }
        // 2026-10-22 第九轮(P1)：onlineOrdersEnabled 不再随上线/下线翻转——它是线上单
        // 开通「审批事实」，只由 /api/online-application/approve|reject 写。旧实现上线即
        // 置 true、下线置 false，审批拒绝活不过下一次状态上报，审批闸门实际失控。
      }

      const dbData = readLocalJsonDb();

      // Retrieve removed phones list
      // 2026-10-21 第四轮(P2-4)：改走双源合并统一口径。此前只读本地 JSON config——
      // MySQL 名单已更新而 JSON 副本过期时，被移除者仍可上报位置复活在线状态。
      const removedPhones = new Set<string>(await readRemovedPhonesMergedUnified().catch(() => [] as string[]));

      // If driver was deleted/removed from squad, strictly clean up and block re-entry
      if (removedPhones.has(phone.replace(/\D/g, '')) && phone !== '15509601222') {
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

      // 2026-10-21 第三轮(P2-3)：位置上报只写 driver_users/driver_locations，不再合并进 squad_members
      // （成员表只由状态机写；且旧逻辑只写 JSON，造成双存储字段分叉）
      const collectionsToUpdate = ['driver_users', 'driver_locations'];
      // 2026-10-21 第四轮(P1-2)：先给合并前的位置文档拍快照。旧代码在合并之后才取 prevLoc，
      // 距离恒为 0、状态恒「未变」，skipMysql 恒真——带坐标的上报 100% 跳过 MySQL 写，
      // 而派单以 MySQL 位置为准，司机移动在生产上永远不被派单看见。
      const prevLocSnapshot = { ...(dbData.driver_locations?.[phone] || {}) };

      collectionsToUpdate.forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      // P0(2026-10-15)：GPS高频上报用批量刷盘（immediate=false），防3000并发下Event Loop阻塞
      writeLocalJsonDb(dbData, false);

      if (isMySQLEnabled && mysqlPool) {
        const mergedLocation = { ...(dbData.driver_locations?.[phone] || {}), ...patch, phone };
        // 2026-10-18优化：司机没动（50米内）且状态没变时，跳过MySQL写，降90%写库压力。
        // 本地JSON照常更新（看门狗和地图读本地，不受影响）。
        const prevLoc = prevLocSnapshot;
        let skipMysql = false;
        if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng) &&
            prevLoc.lat !== undefined && prevLoc.lng !== undefined) {
          const dLat = (lat - Number(prevLoc.lat)) * 111320;
          const dLng = (lng - Number(prevLoc.lng)) * 111320 * Math.cos(Number(prevLoc.lat) * Math.PI / 180);
          const distM = Math.sqrt(dLat * dLat + dLng * dLng);
          const statusChanged = (isOnline !== undefined && Boolean(prevLoc.isOnline) !== Boolean(isOnline)) ||
            (isBusy !== undefined && Boolean(prevLoc.isBusy) !== Boolean(isBusy));
          if (distM < 50 && !statusChanged) skipMysql = true;
        }
        if (!skipMysql) {
          // Fire-and-forget async update with error catching
          // 2026-10-23 第二十五轮：同 /api/driver/status——更新只 MERGE_PATCH 本次 patch 字段，
          // 不再以 JSON 镜像底稿整档覆盖 MySQL，断掉镜像陈旧字段回灌权威源的通道。
          mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)',
            ['driver_locations', phone, JSON.stringify(mergedLocation), JSON.stringify({ ...patch, phone })]
          ).catch(() => {});
          // 2026-10-24 第四十二轮续修1：driver_users 同步 MERGE_PATCH 同一份 patch。
          // 此前本接口只写 driver_locations，driver_users 的 GPS 字段靠客户端额外的
          // dbProxy setDoc 维持（上报一发三写的由来）；服务端在此承接后，客户端可安全
          // 改为 REST 单通道。与 driver_locations 共用 skipMysql 节流（静止约省 90% 写）。
          mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = JSON_MERGE_PATCH(`data`, ?)',
            ['driver_users', phone, JSON.stringify({ ...(dbData.driver_users?.[phone] || {}), ...patch, phone }), JSON.stringify({ ...patch, phone })]
          ).catch(() => {});
        }
      }

      return res.json({ success: true, isOnline: patch.isOnline, serverTime: Date.now(), ...(coordsIgnored ? { coordsIgnored: true } : {}) });
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
            // 2026-10-23 第二十六轮：改与派单组装同口径——MySQL 有行整档为准，JSON 只补
            // MySQL 缺失的手机号。旧实现逐字段覆盖，镜像里陈旧的在线/忙碌/坐标会盖掉权威新值
            // （附近页显示已下线者在线、空闲者忙碌）。
            // 2026-10-23 第三十三轮修复：必须浅拷贝，绝不把缓存原文对象放进响应组装——
            // 下游脱敏（某师傅/手机号打码）与占用折叠（busyReason/isBusy）都是原地改字段，
            // 引用共享会把打码结果永久写回内存数据库：真名变某师傅、phone 变打码号，
            // 后续请求按真号匹配不上成员，附近名单塌缩到只剩查看者本人；刷盘后落盘成真。
            // MySQL 分支的行是逐请求 JSON.parse 的新对象，安全；镜像分支此前是唯一引用口。
            if (!locations[k]) locations[k] = { ...dbData.driver_locations[k] };
          }
        });
      }

      // 2026-10-22 第六轮：附近地图只显示小队内上线司机——按统一口径过滤成员资格
      // （status 已通过、排除 removed；成员文档 MySQL+JSON 双源合并，与本接口既有合并口径一致）。
      // 旧实现只排 removed：非成员（待审/未入队账号）只要上报过位置就会出现在小队附近地图上。
      // 请求者本人与开发者恒保留（本人看不到自己会误判定位故障）；派单不走本接口、不受影响。
      try {
        const memberPhonesLoc = new Set<string>();
        const addApprovedLoc = (doc: any, key: string) => {
          const p = String(doc?.phone || key || '').replace(/\D/g, '').trim();
          if (p && isApprovedMemberStatus(effectiveMemberStatus(doc)) && !removedPhones.has(p)) memberPhonesLoc.add(p);
        };
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [mrowsLoc]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
              ['squad_members']
            );
            (mrowsLoc || []).forEach((r: any) => {
              try { addApprovedLoc(typeof r.data === 'string' ? JSON.parse(r.data) : r.data, String(r.doc_id || '')); } catch (_) {}
            });
          } catch (_) {}
        }
        Object.keys(dbData.squad_members || {}).forEach((k) => addApprovedLoc(dbData.squad_members[k], k));
        const requesterForLoc = String((req as any).authPhone || '').replace(/\D/g, '').trim();
        Object.keys(locations).forEach((k) => {
          const p = String(locations[k]?.phone || k || '').replace(/\D/g, '').trim();
          if (p === '15509601222' || p === requesterForLoc || memberPhonesLoc.has(p)) return;
          delete locations[k];
        });
      } catch (_) {}

      const cutoffMs = getMostRecent0559CutoffMs();
      Object.keys(locations).forEach((k) => {
        const item = locations[k];
        if (item && (item.isOnline === true || item.isOnline === 'true')) {
          // 2026-10-24：改取全部时间字段最大值（旧首个非空链被陈旧 lastLocationTime
          // 遮蔽新鲜 locationTimestamp，生产开发者因此被回以 isOnline=false）。
          const t = docLatestTimeMs(item);

          if (t > 0 && t < cutoffMs) {
            locations[k] = { ...item, isOnline: false, onlineOrdersEnabled: false };
          }
        }
      });

      // 2026-10-22 第七轮：脱敏会把键与 phone 一并换成打码形式，先按条目对象记下真实手机号，
      // 供脱敏后折叠占用显示时对齐（键重映射只搬引用，条目对象身份不变）。
      const entryRealPhone = new Map<any, string>();
      Object.keys(locations).forEach((k) => {
        const item = locations[k];
        if (item) entryRealPhone.set(item, String(item.phone || k || '').replace(/\D/g, '').trim());
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
          const keyRemap = new Map<string, string>();
          for (const k of Object.keys(locations)) {
            const itemPhone = String(locations[k]?.phone || k || '').replace(/\D/g, '').trim();
            if (itemPhone && itemPhone !== requesterPhone) {
              // 遮挡真名，保留位置用于地图显示
              if (locations[k].driverName) locations[k].driverName = '某师傅';
              if (locations[k].name) locations[k].name = '某师傅';
              // 手机号脱敏
              if (locations[k].phone) locations[k].phone = String(locations[k].phone).slice(0, 3) + '****' + String(locations[k].phone).slice(-4);
              // 2026-10-21 第四轮(P1-5)：响应对象的键就是完整手机号（doc_id），value 脱敏形同虚设——
              // 记住要把键一并换成脱敏号，循环后统一改键。
              keyRemap.set(k, String(locations[k].phone || (k.slice(0, 3) + '****' + k.slice(-4))));
            }
          }
          for (const [oldK, baseK] of keyRemap) {
            let newK = baseK;
            let seq = 1;
            while (locations[newK] !== undefined && newK !== oldK) { seq++; newK = `${baseK}#${seq}`; }
            if (newK !== oldK) { locations[newK] = locations[oldK]; delete locations[oldK]; }
          }
        }
      } catch (_) {}

      // 2026-10-22 第七轮：占用折叠显示（只改响应、绝不回写文档）——附近地图忙碌红色的口径
      // 与派单占用同源：行程中（文档 isBusy 原样）∨ 有未决派单 ∨ 报单页心跳新鲜。
      // busyReason: 'trip' | 'pending' | 'reporting'，不忙为 null。开发者与普通成员一视同仁。
      try {
        const pendingMapLocFold = await getPendingDispatchMap();
        Object.keys(locations).forEach((k) => {
          const item = locations[k];
          if (!item) return;
          const realPhone = entryRealPhone.get(item) || String(item.phone || k || '').replace(/\D/g, '').trim();
          const tripBusy = item.isBusy === true || item.isBusy === 'true' || item.isBusy === 1;
          if (tripBusy) {
            item.busyReason = 'trip';
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
      // 2026-10-23 第二十六轮：MySQL 已有行（任意状态）的手机号集合——JSON 补缺不得越过它，
      // 防 MySQL 已驳回/已改状态者被镜像里的旧已通过文档复活进名单（派单不走本接口，仅名单面）。
      const mysqlMemberPhones = new Set<string>();
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

      // 2026-10-22 第六轮(G-P1)：删除一切名字类判定（通用名/虚拟/测试名）——正式成员名为通用名
      // 时曾被整行剔除、名单少计，与统一口径及「后台显示所有司机」裁定冲突。
      // 只保留：手机号非法、removed 名单；status 已通过由调用处 isApprovedMemberStatus 把关。
      const isInvalidDriver = (phone: string) => {
        if (!phone) return true;
        if (phone === '15509601222') return false;
        if (removedPhones.has(phone)) return true;
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
                if (phone) mysqlMemberPhones.add(phone);
                // 2026-10-21 第四轮：名单组装此前无条件先盖 status:'已通过'——无 status 的壳文档
                // 会被冒充成正式成员。改与 getUnifiedMembership 同口径：只有 status/approvalStatus
                // 命中已通过集合的文档才进名单，输出 status 统一规范化。
                if (phone && !seen.has(phone) && !isInvalidDriver(phone) && isApprovedMemberStatus(effectiveMemberStatus(parsed))) {
                  seen.add(phone);
                  list.push({ ...parsed, id: r.doc_id, phone, status: '已通过' });
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
          if (phone && !seen.has(phone) && !mysqlMemberPhones.has(phone) && !isInvalidDriver(phone) && isApprovedMemberStatus(effectiveMemberStatus(m))) {
            seen.add(phone);
            list.push({ ...m, id: k, phone, status: '已通过' });
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

      // 2026-10-22 第六轮：不再把改名司机写入 AUTHORITATIVE_REAL_DRIVER_NAMES 运行时表——
      // 旧逻辑使任何司机改名后即永久豁免通用名过滤（纯内存态、改名只验长度），属隐性提权面。

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
            // 2026-10-20根治：除 driver_users 外，其他集合无现行文档时不凭空建"姓名壳"。
            // 这种壳只有姓名没有 status/phone，会成为通用接口镜像的底稿，
            // 覆盖掉 /api/squad-apply 写入的带 status 的好申请（审核中闪烁根因之一）。
            if ((!rows || rows.length === 0) && col !== 'driver_users') continue;
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
        // 2026-10-20根治：同 MySQL 分支，JSON 侧也不给其他集合凭空建"姓名壳"
        if (!dbData[col][phone] && col !== 'driver_users') continue;
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

  // 2026-10-24 第四十四轮：防重入——批量下线一轮可能超过 60 秒间隔，重叠执行只会重复劳动
  let _guard0559Running = false;
  setInterval(async () => {
    if (_guard0559Running) return;
    _guard0559Running = true;
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
      // 2026-10-23 第二十五轮：进行中订单判定改读权威源（MySQL 启用时只读 MySQL）。
      // 旧实现只扫 JSON 镜像——镜像丢了一笔进行中订单时，05:59 会把正在跑单的司机强制下线。
      const merchantOrders = await loadMerchantOrdersCanonical();

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
        // 2026-10-23 第三十三轮修复：loadMerchantOrdersCanonical 返回 [docId, order] 元组数组，
        // 此前用 for...in 遍历数组只能拿到下标、order 恒为元组本身，dispatchedDriverPhone 恒
        // undefined——在途单豁免自第二十五轮改权威源后实际失效，手持进行中订单的司机在
        // 05:59 守护轮次会被直接下线。改与其它消费方同口径的元组解构遍历。
        for (const [, order] of merchantOrders) {
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
      // 2026-10-24 第四十四轮修两处：
      // ① 在线时间改跨三表按字段逐个找：旧实现 driverUsers 文档一存在就短路，哪怕该文档
      //    没有任何时间字段（时间只写在 driver_locations 上）也判 0 → 误判全员过期批量下线。
      // ② 过期名单先收集、再 50 人一组并发下线：旧实现逐个 await 串行，3000 人一轮在
      //    MySQL 模式也要数十秒；配合 performServerOffline 的异步刷盘改动，整轮降到秒级。
      const expiredPhones: string[] = [];
      for (const phone of Array.from(onlineDriverPhones)) {
        // 2026-10-24：三表 × 全部时间字段取最大值（旧实现逐表首个非空即停，
        // 任一表里的陈旧字段都会遮蔽定位表的新鲜上报、把在线司机误判过期下线）。
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
        await Promise.all(chunk.map((phone) =>
          performServerOffline(phone, is0559Time ? 'daily_0559_scheduled_idle' : 'daily_0559_expired_cutoff').catch(() => {})
        ));
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
    } finally {
      _guard0559Running = false;
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
      const { orderData, pickupLat, pickupLng } = req.body || {};
      // 2026-10-23 第二十一轮(H2)：reporterPhone/excludePhone 不再取请求体——旧口径下
      // 商户给普通代叫单加 orderRemark='报单转单' 并指定 excludePhone，即可定向排除
      // 任意司机（负向选人，绕过「商户不能选司机」铁律）。排除只认 token 本人：
      // 司机身份调用时排除自己（转单不派给自己），商户 A 身份不产生任何排除。
      const rawAuthForDispatch = String((req as any).authPhone || '').trim();
      const authDriverDigits = /a$/i.test(rawAuthForDispatch) ? '' : rawAuthForDispatch.replace(/\D/g, '').trim();
      const reporterPhone = authDriverDigits;
      const excludePhone = authDriverDigits;
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
        // 2026-10-23 第二十一轮(H1)：订单状态字段一律服务端生成，客户端预置即剥离。
        // 旧口径只删派单司机两字段，预置 claimedDriverPhone 会让被派司机接单命中
        // 「已被抢走」、订单进大厅后全员抢不到（毒单）；预置 declined/timeout 名单可
        // 定向封杀司机；预置 coordsUnknown 可绕过就近派单强制进大厅变相选人。
        for (const poisonField of ['claimedDriverPhone', 'claimedDriverName', 'claimedAt',
          'declinedDriverPhones', 'timeoutDriverPhones', 'rejectedDriverPhones',
          'coordsUnknown', 'in_hall', 'status', 'statusCategory', 'isCancelled', 'hallAt', 'hallReason', // 2026-10-23 第二十五轮：补剥 isCancelled——预置 true 的毒单被接单后会同时是 claimed 与已取消，读 IC 的消费方误判终态
          'dispatchedAt', 'dispatchExpiresAt', 'dispatchCountdown', 'serverCountdown',
          'paymentQrCode', 'qrCode', 'wechatQrCode', 'driverQrCode', 'qrcode_url',
          'assignedDriver', 'assignedDriverPhone']) {
          delete (orderData as any)[poisonField];
        }
        // 2026-10-23 第二十六轮补充（用户拍板）：金额服务端锚定。商户单起步价是平台标准
        // ¥40（现行下单端写死此值），此前 calculatedTotalFee/price 等字段由下单端原样落库、
        // 还充当行程的锁定起步价——被改包的商户端可任意标价、乘客照单支付。现建单时一律
        // 以服务端标准价覆盖、客户端传值不落库；行程中的里程/等候等费用在行程页按实际
        // 轨迹另行结算、不走建单字段，不受此锚影响。
        (orderData as any).calculatedTotalFee = 40;
        (orderData as any).estimatedPrice = '40.00';
        (orderData as any).price = '¥40.00';
        delete (orderData as any).fare;
        delete (orderData as any).totalFee;
        // 2026-10-24 第四十九轮（fuzz 实证）：订单展示文本字段原无长度上限，200KB 的
        // startLocation 被原样落库，进每个司机的列表轮询载荷长期膨胀。建单时统一截断
        // 展示类文本（地址/名称/备注）到 300 字——真实地址远不及此；功能字段（电话、
        // 二维码、坐标）不在此列，不误伤。
        for (const textField of ['startLocation', 'endLocation', 'destination', 'dropoffName',
          'pickupName', 'startAddress', 'endAddress', 'passengerName', 'remark', 'orderRemark', 'note']) {
          const v = (orderData as any)[textField];
          if (typeof v === 'string' && v.length > 300) {
            (orderData as any)[textField] = v.slice(0, 300);
          }
        }
        // 2026-10-21 第四轮(E2/F2 实测)：orderData 未带 merchantPhone 时以 token 身份兜底补写。
        // 否则订单里没有下单方字段，商户本人 true-cancel/cancel 会被归属校验拒绝、取消不了自己的单。
        if (!String((orderData as any).merchantPhone || '').trim()) {
          const placerPhone = String((req as any).authPhone || '').trim();
          if (placerPhone) (orderData as any).merchantPhone = placerPhone;
        }
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
          // 2026-10-21 第三轮(P2-4)：改走 getUnifiedMembership 统一口径（双存储通吃）。
          // 旧实现只查 MySQL 的 role 字符串：JSON 模式/灾备回退时管理被误锁 403，
          // 且不验成员状态——残留 role 的非已通过文档理论上也能过门。
          const mship: any = await getUnifiedMembership(authPhone);
          const mRole = String(mship?.role || '');
          const mPos = String(mship?.squadPosition || '');
          isManager = !!mship?.isMember && (MANAGER_ROLES.some(r => mRole.includes(r)) || ['boss', 'manager', 'dispatcher'].includes(mPos));
        } catch (_) {}
        if (!isManager) {
          // 2026-10-21 第四轮：早退必须释放派单锁，否则该单 60 秒内合法重试被 409 误挡
          if (lockOrderId) dispatchOrderLocks.delete(lockOrderId);
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
      let driverDocMap: Record<string, any> = {};
      // 第四十四轮：候选池缓存命中则整段跳过下方三张全表组装（逻辑与结构不变）
      const _poolHit = await getDispatchPoolsCached();
      if (_poolHit) {
        squadList = _poolHit.squadList;
        locationMap = _poolHit.locationMap;
        driverDocMap = _poolHit.driverDocMap;
      }
      if (!_poolHit) {
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

      // 2026-10-22 第六轮：授权/VIP 判定改走统一口径——预载 driver_users 全表，
      // 候选过滤与终检用 resolveExpiryFromDocs(成员文档, 档案文档) 解析（成员文档权威优先、
      // 档案兜底）。旧实现只读 squad_members 单表：档案有值而成员表空值即误淘汰合格司机。
      // （driverDocMap 已在组装段顶部声明，第四十四轮起随候选池一并缓存。）
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [duRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['driver_users']
          );
          (duRows || []).forEach((r: any) => {
            try {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              const p = String(r.doc_id || d?.phone || '').replace(/\D/g, '').trim();
              if (p) driverDocMap[p] = d;
            } catch (_) {}
          });
        } catch (_) {}
      }
      Object.keys(dbData['driver_users'] || {}).forEach((k) => {
        const p = String(k).replace(/\D/g, '').trim();
        if (p && !driverDocMap[p]) driverDocMap[p] = dbData['driver_users'][k];
      });

      // 第四十四轮：组装完成，写入候选池缓存供后续 3 秒内的派单复用
      await saveDispatchPoolsCache({ squadList, locationMap, driverDocMap });
      } // !_poolHit 组装段结束

      // P2(2026-10-16)：订单ID加随机后缀，防同一毫秒创建的两单重ID串单
      // 2026-10-23 第二十六轮：orderNo 不再充当文档 id。YC 号是客户端本地计数生成
      // （分钟粒度+本机序号），跨设备同分钟必撞——两单同 YC 时后单会覆盖先单文档。
      // 文档 id 只认 id/orderId，缺失时服务端生成（现行客户端恒带 MO_ id，不受影响）。
      const orderId = String(orderData.id || orderData.orderId || `ORDER_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`).trim();

      // 2026-10-22 第七轮：占用淘汰的事实来源——未决派单全图（带缓存，高频调用不重复扫表）
      const pendingMap = await getPendingDispatchMap();
      const activeClaimedSet = await getActiveClaimedDriverSet().catch(() => new Set<string>());

      // Candidate drivers filter (Strictly approved squad drivers only)
      const candidates: Array<{ phone: string; name: string; distKm: number; data: any }> = [];
      let removedPhonesArr: string[] = [];
      try { removedPhonesArr = await readRemovedPhonesMergedUnified(); } catch (_) { removedPhonesArr = dbData.config?.['removed_squad_members']?.phones || []; }

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
        // 2026-10-23 第二十三轮：改读 effectiveMemberStatus（在线态毒化穿透 approvalStatus）；
        // 开发者恒成员豁免本关（与统一成员口径一致），接单授权关不豁免。
        const st = effectiveMemberStatus(data);
        if (cleanPhone !== '15509601222' && !['已通过', 'approved', '通过'].includes(st)) {
          diagPush(cleanPhone, `审批未通过(status=${st || '空'})`);
          return;
        }

        // 2.5 接单授权检查 (2026-10-15)：天数为0时不派单，无豁免（含开发者本人）
        // 2026-10-22 第六轮：licenseExpiry 改统一口径解析（成员文档优先、driver_users 兜底）
        const candLic = resolveExpiryFromDocs(data, driverDocMap[cleanPhone]).licenseExpiry;
        if (!isLicenseValid(candLic)) {
          diagPush(cleanPhone, `接单授权无效(licenseExpiry=${candLic || '空'})`);
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

        // 2026-10-22 第七轮：占用淘汰——已有未决派单（新来单弹窗未处理）或正在报单页
        // （心跳 45 秒内新鲜）的司机不再派第二单，防一人同时持有两单。
        // 占用按事实计算、不写 isBusy，故不会触发 claim 的忙碌守卫自锁（2026-10-17 旧雷）。
        {
          const occ = occupancyOf(cleanPhone, pendingMap, loc);
          if (occ.occupied) {
            diagPush(cleanPhone, occ.reason === 'pending' ? '有未决派单' : '报单中');
            return;
          }
        }

        // 2026-10-23 第二十一轮(H3)：行程占用按订单事实淘汰——已持有未终态接单的
        // 司机不再派新单（与 isBusy 标志双保险，标志被自清也拦得住）。
        if (activeClaimedSet.has(cleanPhone)) {
          diagPush(cleanPhone, '已有进行中的接单(订单事实)');
          return;
        }

        // H-G2修复：明确标记无GPS的上线司机直接跳过（滑动上线即上报功能：无GPS时只传时间戳不传坐标，
        // 旧坐标残留+新鲜时间戳会导致按几小时前位置误派单）。gpsValid 为 undefined 的老数据按有GPS兼容处理。
        if ((loc as any).gpsValid === false) {
          diagPush(cleanPhone, 'GPS无效标记(gpsValid=false)');
          return;
        }

        // 2026-10-23 第十八轮：坐标读取兼容 latitude/longitude 别名（与报单转单/附近页
        // 同口径）。旧实现只认 lat/lng，别名格式定位文档在附近页可见、商户派单却判
        // 「坐标无效」永不派单。
        let dLat = Number(loc.lat ?? loc.latitude ?? data.lat ?? (data as any).latitude);
        let dLng = Number(loc.lng ?? loc.longitude ?? data.lng ?? (data as any).longitude);

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
        // 2026-10-22 第八轮：删「优先复用 existingDispatchedPhone」死代码——入口铁律已
        // delete orderData.dispatchedDriverPhone，existing 恒为空串、find 恒落空，防重派
        // 实际由派单冷却 + H6 写前复查承担。选人统一走最近 + 20 米同池随机。
        let selected: any = null;
        {
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
          const selLic = resolveExpiryFromDocs((selected as any)?.data, driverDocMap[String(selected.phone).replace(/\D/g, '').trim()]).licenseExpiry;
          if (!isLicenseValid(selLic)) {
            console.log(`[Dispatch] 司机 ${selected.phone} 接单授权无效，最终拦截：订单 ${orderId} 直接转入选单大厅`);
            selected = null as any;
          }
        }
        // P0(2026-10-15)：非VIP每日2单服务端强制限制
        // 2026-10-17: 加日志+10秒超时。全表扫描曾导致派单请求静默卡死（04:40实测）。
        if (selected) {
          const selVip = resolveExpiryFromDocs((selected as any)?.data, driverDocMap[String(selected.phone).replace(/\D/g, '').trim()]).vipExpiry;
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
        // 2026-10-17 正式版恢复：05:30 的临时 bypass 是"疑似卡死"的预防措施，从未证实。
        // mysqlQueryTimeout 本就是 Promise.race + 5秒定时器，异步不可能阻塞事件循环；真正堵死的
        // 是本地 JSON 分支的 readFileSync（v6 卡死根因），正式版已改为异步读。保护逻辑完整恢复。
        // MySQL 分支走 mysqlQueryTimeout（5秒硬超时，异步不堵事件循环）；
        // 本地 JSON 分支改异步读文件（原 readLocalJsonDb 的 readFileSync 大文件阻塞事件循环是 v6 派单卡死根因，
        // 正式版改为 fs.promises 异步读；内存有脏数据时直接用内存缓存，语义与 readLocalJsonDb 一致）。
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
            try {
              if (_dbDirty && cachedDbData) {
                freshOrder = cachedDbData?.['merchant_orders']?.[orderId];
              } else {
                const content = await fs.promises.readFile(LOCAL_JSON_DB_PATH, 'utf8');
                const freshDb = JSON.parse(content || '{}');
                freshOrder = freshDb?.['merchant_orders']?.[orderId];
              }
            } catch (e: any) {
              console.error(`[Dispatch] 订单 ${orderId} H6本地读取失败，按未派单继续:`, e?.message);
            }
          }
          const alreadyDispatched = String(freshOrder?.dispatchedDriverPhone || '').trim();
          const alreadyClaimed = String(freshOrder?.claimedDriverPhone || '').trim();
          if (alreadyDispatched || alreadyClaimed) {
            console.log(`[Dispatch] 订单 ${orderId} 已被派单/抢单（${alreadyDispatched || alreadyClaimed}），本次跳过写入`);
            return res.json({ success: true, dispatched: true, driverPhone: alreadyDispatched || alreadyClaimed, alreadyDispatched: true });
          }
        }

        // 接单授权拦截后无可用司机：订单直接转入选单大厅
        if (!selected) {
          const hallPayload = {
            ...orderData,
            id: orderId,
            orderId: orderId,
            ...coordFields,
            status: 'hall',
            in_hall: true,
            statusCategory: '等待接单', // 2026-10-23 第二十五轮：与无候选分支同口径补分类，防徽章分类三分裂
            hallReason: 'no_licensed_driver',
            hallAt: Date.now(),
            timestamp: Date.now(),
          };
          try {
            // 2026-10-22 第八轮：与主派单路径同口径——双写（JSON 镜像 + MySQL 重试3次），
            // 写失败返回 500 不报假成功（旧实现 catch 吞错，MySQL 模式还没 JSON 兜底，可真丢单）。
            const db2 = readLocalJsonDb();
            db2['merchant_orders'] = db2['merchant_orders'] || {};
            db2['merchant_orders'][orderId] = hallPayload;
            writeLocalJsonDb(db2);
            if (isMySQLEnabled && mysqlPool) {
              let hallWriteErr: any = null;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  await mysqlPool.query(
                    'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                    ['merchant_orders', orderId, JSON.stringify(hallPayload)]
                  );
                  hallWriteErr = null; break;
                } catch (e) { hallWriteErr = e; }
              }
              if (hallWriteErr) throw hallWriteErr;
            }
          } catch (e: any) {
            console.error(`[Dispatch] 订单 ${orderId} 无授权司机转大厅写入失败:`, e?.message);
            return res.status(500).json({ success: false, error: '订单转大厅写入失败，请重试' });
          }
          console.log(`[Dispatch] 订单 ${orderId} 无授权司机，直接转入选单大厅`);
          return res.json({ success: true, dispatched: false, toHall: true, reason: 'no_licensed_driver', ...(diagForDev ? { diag: diagForDev } : {}) });
        }

        const distText = selected.distKm < 1.0 
          ? `${Math.max(50, Math.round(selected.distKm * 1000))}米` 
          : `${selected.distKm.toFixed(2)}公里`;
        const nowTs = Date.now();
        // 2026-10-22 第七轮：删除「旧单顶替」——旧实现把司机未处理的旧派单直接改大厅给新单
        // 让路（hallReason 已随本段删除），造成旧单倒计时串值、弹窗无故消失。新口径：写单前对
        // 选中司机做一次 fresh 未决复查（绕缓存，与上方 H6 同临界段强度）；并发竞态下该司机
        // 刚被派了别的单时，本单转大厅（hallReason=pending_conflict），绝不顶掉旧单。
        {
          const pendFresh = await getPendingDispatchForPhone(String(selected.phone).trim(), true).catch(() => null);
          if (pendFresh && pendFresh.orderId !== orderId) {
            const conflictPayload = {
              ...orderData,
              id: orderId,
              orderId: orderId,
              ...coordFields,
              status: 'hall',
              in_hall: true,
              statusCategory: '等待接单', // 2026-10-23 第二十五轮：同上
              hallReason: 'pending_conflict',
              hallAt: nowTs,
              timestamp: nowTs,
            };
            try {
              // 2026-10-22 第八轮：同 no_licensed_driver 分支口径——双写+重试+失败 500。
              const db3 = readLocalJsonDb();
              db3['merchant_orders'] = db3['merchant_orders'] || {};
              db3['merchant_orders'][orderId] = conflictPayload;
              writeLocalJsonDb(db3);
              if (isMySQLEnabled && mysqlPool) {
                let conflictWriteErr: any = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    await mysqlPool.query(
                      'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                      ['merchant_orders', orderId, JSON.stringify(conflictPayload)]
                    );
                    conflictWriteErr = null; break;
                  } catch (e) { conflictWriteErr = e; }
                }
                if (conflictWriteErr) throw conflictWriteErr;
              }
            } catch (e: any) {
              console.error(`[Dispatch] 订单 ${orderId} pending_conflict 转大厅写入失败:`, e?.message);
              return res.status(500).json({ success: false, error: '订单转大厅写入失败，请重试' });
            }
            console.log(`[Dispatch] 订单 ${orderId} 选中司机 ${selected.phone} 已有未决派单 ${pendFresh.orderId}（并发竞态），本单转大厅(pending_conflict)，不顶旧单`);
            return res.json({ success: true, dispatched: false, toHall: true, reason: 'pending_conflict', ...(diagForDev ? { diag: diagForDev } : {}) });
          }
        }
        // 2026-10-23 第二十一轮(L6)：司机未在服务器传码时不得拼造收款码 URL（与报单通道 9914 的 existsSync 口径一致）；无码置空，避免乘客扫到不存在/过期码。
        const driverQrUrl = fs.existsSync(path.join(process.cwd(), 'uploads', 'qrcodes', `${selected.phone}.png`)) ? `/uploads/qrcodes/${selected.phone}.png` : '';
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
                // 2026-10-24 第四十二轮续修3：8 秒 → 3 秒。旧口径双写最坏尾
                // 2 写 × 3 次 × 8 秒 ≈ 49 秒（乘客端表现为派单长卡）；正常写为
                // 毫秒级，3 秒足够区分「慢」与「hang 死」，重试次数保留 3 次。
                await mysqlQueryTimeout(mysqlPool, sql, params, 3000, `派单双写(尝试${attempt}/3)`);
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
          timestamp: nowTs,
          hallAt: nowTs
        };

        if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
        dbData['merchant_orders'][orderId] = hallPayload;

        writeLocalJsonDb(dbData);

        if (isMySQLEnabled && mysqlPool) {
          // 2026-10-22 第八轮：与主路径同口径——重试3次仍失败返回 500（旧实现吞错，
          // 造成 JSON 有单、MySQL 无单的镜像分叉，下单方还以为成功）。
          let lobbyWriteErr: any = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['merchant_orders', orderId, JSON.stringify(hallPayload)]
              );
              lobbyWriteErr = null; break;
            } catch (e) { lobbyWriteErr = e; }
          }
          if (lobbyWriteErr) {
            console.error(`[Dispatch] 订单 ${orderId} 无候选转大厅 MySQL 写入失败:`, lobbyWriteErr?.message);
            return res.status(500).json({ success: false, error: '订单转大厅写入失败，请重试' });
          }
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
        const failOrderId = String((req.body?.orderData as any)?.orderId || (req.body?.orderData as any)?.id || (req.body?.orderData as any)?.orderNo || '').trim();
        if (failOrderId) dispatchOrderLocks.delete(failOrderId);
      } catch (_) {}
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.1 Atomic Order Grab / Claim from 选单大厅
  app.post('/api/order/claim', requireDbAuth, orderLockMiddleware, async (req, res) => {
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
      // 2026-10-22 第六轮：改走 readDriverExpiryUnified 统一口径（squad_members 权威优先、driver_users 兜底）
      let claimExpiryUnified: { licenseExpiry: string; vipExpiry: string } | null = null;
      try {
        claimExpiryUnified = await readDriverExpiryUnified(cleanDriverPhone);
        if (!isLicenseValid(claimExpiryUnified.licenseExpiry)) {
          return res.status(403).json({ success: false, error: '接单授权已到期，请联系开发者充值' });
        }
      } catch (e) {
        console.error('[Claim] 接单授权校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '授权校验失败，请重试' });
      }
      // P0(2026-10-15)：非VIP每日2单服务端强制限制
      try {
        const vipExpiry = claimExpiryUnified ? claimExpiryUnified.vipExpiry : (await readDriverExpiryUnified(cleanDriverPhone)).vipExpiry;
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
      let removedPhonesArr: string[] = [];
      try { removedPhonesArr = await readRemovedPhonesMergedUnified(); } catch (_) { removedPhonesArr = dbData.config?.['removed_squad_members']?.phones || []; }
      const isRemovedDriver = cleanDriverPhone !== '15509601222' && removedPhonesArr.includes(cleanDriverPhone);
      const isDevDriver = cleanDriverPhone === '15509601222';

      let isSquadApproved = isDevDriver;
      if (!isDevDriver && !isRemovedDriver) {
        // P1(2026-10-16)：审批口径收紧——① MySQL 优先读（本地 JSON 可能滞后）；
        // ② 去掉 || !st：空状态不再算通过，必须是明确的已通过状态。
        // 2026-10-22 第六轮：成员文档改走 readStatusDocument 统一口径——MySQL 启用时只认 MySQL，
        // 不再回退本地 JSON（旧回退使 MySQL 已删成员凭 JSON 残留已通过文档仍可抢单，与统一口径相悖）。
        let squadDoc: any = null;
        try { squadDoc = await readStatusDocument('squad_members', cleanDriverPhone); } catch (_) {}
        if (squadDoc && isApprovedMemberStatus(effectiveMemberStatus(squadDoc))) {
          isSquadApproved = true;
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
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [brows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['driver_locations', cleanDriverPhone]);
            if (brows && brows.length > 0) {
              const braw = brows[0].data;
              busyLoc = typeof braw === 'string' ? JSON.parse(braw) : braw;
            }
          } catch (_) {
            // MySQL 读取失败：busyLoc 保持 null，下一行回退读本地缓存
          }
        }
        if (!busyLoc) { busyLoc = dbData.driver_locations?.[cleanDriverPhone]; }
        if (busyLoc && (busyLoc.isBusy === true || busyLoc.isBusy === "true" || busyLoc.isBusy === 1)) {
          return res.status(409).json({ success: false, error: '您当前有行程中的订单，请完成后再抢单' });
        }
      } catch (_) {}

      // 2026-10-23 第二十一轮(H3)：订单事实占用校验——本人已有其他未终态的已接订单时
      // 不许再接（isBusy 标志可被自清，订单事实不能）。本单幂等重入由下方 claimedByMe 处理。
      try {
        const activeOther = await findDriverActiveOrderId(cleanDriverPhone, cleanOrderId);
        if (activeOther) {
          return res.status(409).json({ success: false, error: '您已有进行中的订单，请完成后再接单' });
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
      // 2026-10-23 第二十一轮(L6)：同派单口径，无码不拼造。
      const driverQrUrl = fs.existsSync(path.join(process.cwd(), 'uploads', 'qrcodes', `${cleanDriverPhone}.png`)) ? `/uploads/qrcodes/${cleanDriverPhone}.png` : '';
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

      // 2026-10-21 第四轮：JSON 镜像在本接口是先行写入的；MySQL 条件 UPDATE 若判失败（被抢走/写失败），
      // 必须把镜像按 MySQL 现状回滚，否则本地长期停在 claimed 的假状态（反向幽灵单）。
      const rollbackClaimJsonMirror = async () => {
        try {
          const [rrows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['merchant_orders', cleanOrderId]
          );
          const jdb = readLocalJsonDb();
          if (!jdb['merchant_orders']) jdb['merchant_orders'] = {};
          if (rrows && rrows.length > 0) {
            jdb['merchant_orders'][cleanOrderId] = typeof rrows[0].data === 'string' ? JSON.parse(rrows[0].data) : rrows[0].data;
          }
          const cur = jdb['merchant_orders'][cleanOrderId];
          if (cur && String(cur.claimedDriverPhone || '') !== cleanDriverPhone &&
              jdb['active_orders']?.[cleanDriverPhone]?.orderId === cleanOrderId) {
            delete jdb['active_orders'][cleanDriverPhone];
          }
          const [lrows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['passenger_links', cleanDriverPhone]
          );
          if (lrows && lrows.length > 0) {
            if (!jdb['passenger_links']) jdb['passenger_links'] = {};
            jdb['passenger_links'][cleanDriverPhone] = typeof lrows[0].data === 'string' ? JSON.parse(lrows[0].data) : lrows[0].data;
          }
          writeLocalJsonDb(jdb);
        } catch (_) {}
      };

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
              await rollbackClaimJsonMirror();
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
          await rollbackClaimJsonMirror();
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
          for (const col of ['driver_locations', 'driver_users']) {
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(TRUE AS JSON)) WHERE `collection` = ? AND `doc_id` = ?',
              [col, cleanDriverPhone]
            ).catch(() => {});
          }
        } catch (_) {}
      } else {
        for (const col of ['driver_locations', 'driver_users']) {
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
    } catch (err: any) {
      console.error('[Order Claim Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // 5.2.2 ABSOLUTE Order Cancellation (Marks order as cancelled everywhere so it disappears from hall for ALL drivers)
  app.post('/api/order/cancel', requireDbAuth, orderLockMiddleware, async (req, res) => {
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
      // 2026-10-24 第四十六轮修复（实验室实证）：小队管理层（城市老板/城市管理/城市派单员）
      // 取消他人订单被 403——App 端「取消派单」明明对这四个角色开放（派单台 canCancel 名单），
      // 服务端却只认下单方/接单司机/开发者，管理层点了必然失败、界面与服务端分叉。
      // requireDbAuth 已按统一成员状态机算好 isManager/isDispatcher，与客户端名单同口径放行；
      // 普通司机仍只能取消自己关联的订单。服务中/已完成不可取消的状态裁决在下方对所有人一致生效。
      const isManagement = isAdmin || !!(req as any).isManager || !!(req as any).isDispatcher;
      if (!isManagement) {
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
        isCancelled: true, // 2026-10-23 第二十五轮：与 true-cancel 口径对齐——此前本接口订单文档独缺 isCancelled，只写 isCancelled 的通知文档反而齐全，终态判据踩缝
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
      let canonicalOrder: any = null;
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
            canonicalOrder = sd;
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
      // 2026-10-21 第四轮(P1-4)：合并底稿以 MySQL 权威文档为准。旧逻辑只拿本地 JSON 副本拼载荷，
      // JSON 缺这条单时（报单转单/大厅抢单的单）会把 MySQL 订单洗成只剩取消字段、历史信息不可恢复。
      const targetMerchant = canonicalOrder || dbData['merchant_orders'][orderId] || {};
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
          cancelledAt: now,
          timestamp: now, // 第二十六轮：给 48 小时清扫器留可识别时戳（与 cancelledAt 兜底双保险）
          updatedAt: now
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
            lastStatusUpdateTime: now
          };
        }
        if (dbData['driver_locations'] && dbData['driver_locations'][assignedDriver]) {
          dbData['driver_locations'][assignedDriver] = {
            ...dbData['driver_locations'][assignedDriver],
            isBusy: false,
            lastStatusUpdateTime: now
          };
        }
        if (dbData['squad_members'] && dbData['squad_members'][assignedDriver]) {
          dbData['squad_members'][assignedDriver] = {
            ...dbData['squad_members'][assignedDriver],
            isBusy: false,
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
              timestamp: now,
              updatedAt: now,
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
                  // 2026-10-21 第二轮修复(P0)：不再写 dd.status='idle'。818df061 已根治 JSON 侧与
                  // claim/complete 等路径，此 MySQL 分支当时漏网——squad_members.status 被写 idle 后
                  // 司机立刻被成员判定淘汰（状态读只认 MySQL）。与 JSON 分支对齐：只清 isBusy。
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
          // dispatchExpiresAt 的权威写入者只有派单（含报单转单）建单时的初始设置；countdown 接口只读不写（旧「延迟重置」逻辑已于 2026-10-13 删除，此前注释误导排查）。
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
              hallAt: now,
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

            // 2026-10-22 第八轮：该司机若已另有进行中行程（active_orders 指向别的订单且在
            // 已接单/服务中状态），其忙碌属于那笔行程——本单的超时清理不许删他的进行中
            // 订单、更不许清他的忙碌（旧实现无条件清，≤10 秒窗内可把刚抢的新单忙碌误清）。
            const sweeperActiveDoc = dbData['active_orders']?.[timedOutDriverPhone];
            const sweeperHasOtherTrip = !!sweeperActiveDoc &&
              String(sweeperActiveDoc.orderId || sweeperActiveDoc.id || '').trim() !== orderId &&
              ['claimed', 'arrived', 'serving', '已接单', '司机到达', '服务中'].includes(String(sweeperActiveDoc.status || ''));

            // 清理并标记该司机的来单通道为超时取消，解除来单弹窗
            if (dbData['passenger_links'] && dbData['passenger_links'][timedOutDriverPhone]) {
              delete dbData['passenger_links'][timedOutDriverPhone];
            }
            if (!sweeperHasOtherTrip && dbData['active_orders'] && dbData['active_orders'][timedOutDriverPhone]) {
              delete dbData['active_orders'][timedOutDriverPhone];
            }

            // 解除司机的忙碌状态，恢复为空闲
            if (!sweeperHasOtherTrip && dbData['driver_users'] && dbData['driver_users'][timedOutDriverPhone]) {
              dbData['driver_users'][timedOutDriverPhone] = {
                ...dbData['driver_users'][timedOutDriverPhone],
                isBusy: false,
                lastStatusUpdateTime: now
              };
            }
            if (!sweeperHasOtherTrip && dbData['driver_locations'] && dbData['driver_locations'][timedOutDriverPhone]) {
              dbData['driver_locations'][timedOutDriverPhone] = {
                ...dbData['driver_locations'][timedOutDriverPhone],
                isBusy: false,
                lastStatusUpdateTime: now
              };
            }
            if (!sweeperHasOtherTrip && dbData['squad_members'] && dbData['squad_members'][timedOutDriverPhone]) {
              dbData['squad_members'][timedOutDriverPhone] = {
                ...dbData['squad_members'][timedOutDriverPhone],
                isBusy: false,
                lastStatusUpdateTime: now
              };
            }

            if (isMySQLEnabled && mysqlPool) {
              try {
                // 2026-10-17：merchant_orders 的条件写入已在上方完成，此处只做关联清理
                // 2026-10-22 第八轮：passenger_links 照删；active_orders 与 busy 重置受
                // sweeperHasOtherTrip 守卫（司机另有行程时不动，口径同上方 JSON 分支）。
                await mysqlPool.query(
                  'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                  ['passenger_links', timedOutDriverPhone]
                );
                if (!sweeperHasOtherTrip) {
                  await mysqlPool.query(
                    'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                    ['active_orders', timedOutDriverPhone]
                  );
                }
                // P0(2026-10-15)：转大厅后同步重置司机busy状态到MySQL，否则司机永久busy接不到单
                for (const col of sweeperHasOtherTrip ? [] : ['driver_locations', 'driver_users']) {
                  try {
                    const [drows]: any = await mysqlPool.query(
                      'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                      [col, timedOutDriverPhone]
                    );
                    if (drows && drows.length > 0) {
                      const dd = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
                      dd.isBusy = false;
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
      const driverPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim(); // 2026-10-20 重构(P2)：心跳只认 token 本人，防冒名给他人订单续命压制转大厅
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
            'WHERE `collection` = ? AND (`doc_id` = ? OR JSON_EXTRACT(`data`, "$.id") = ? OR JSON_EXTRACT(`data`, "$.orderId") = ?) ' +
            'AND JSON_UNQUOTE(JSON_EXTRACT(`data`, "$.dispatchedDriverPhone")) = ?',
            [now, 'merchant_orders', orderId, orderId, orderId, driverPhone]
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
          if (v && (v.id === orderId || v.orderId === orderId || v.orderNo === orderId || k === orderId) && String(v.dispatchedDriverPhone || '').replace(/\D/g, '') === driverPhone) {
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
      const purePhone = phone.replace(/A$/, '');
      // 2026-10-21 第四轮：此前只读本地 JSON——MySQL 模式下镜像过期就报旧有效期
      // （兑换成功仍显示旧值）。改走 readCanonicalDocument（MySQL 优先、JSON 兜底）按原顺序逐集合回退。
      let vipExpiry = '';
      // 2026-10-22 第六轮：回退链去掉 online_applications——申请表旧值会让已无 VIP 的司机仍显示有效
      const vipChain: Array<[string, string]> = [
        ['driver_users', phone], ['driver_users', purePhone],
        ['squad_members', phone], ['squad_members', purePhone]
      ];
      for (const [c, id] of vipChain) {
        const doc = await readCanonicalDocument(c, id).catch(() => null);
        if (doc && doc.vipExpiry) { vipExpiry = String(doc.vipExpiry); break; }
      }
      return res.json({ success: true, vipExpiry });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  });

  // 5.2.9 哈勃权限管理 API (2026-10-14新增)
  // 只有开发者 15509601222 可以授权/取消授权，其他人只能查询
  app.get('/api/hubble/authorized_drivers', requireDbAuth, async (req: any, res: any) => {
    try {
      // 2026-10-21 第三轮(P2-6)：名单含被授权司机手机号+姓名，此前任意登录用户可读；
      // 唯一调用方是开发者用的 HubbleManagerModal，收紧到开发者本人。
      const requesterH = String((req as any).authPhone || '').replace(/\D/g, '');
      if (requesterH !== DEVELOPER_PHONE_SERVER) {
        return res.status(403).json({ success: false, message: '仅开发者可查看哈勃授权名单' });
      }
      const dbData = readLocalJsonDb();
      const col: Record<string, any> = { ...(dbData['hubble_authorized_drivers'] || {}) };
      // 2026-10-21 第四轮(P2-3)：名单读改双源合并（MySQL 条目覆盖同号 JSON 条目），与写入双写对齐
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [hrows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['hubble_authorized_drivers']
          );
          (hrows || []).forEach((r: any) => {
            try {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              if (d) col[String(r.doc_id)] = d;
            } catch (_) {}
          });
        } catch (_) {}
      }
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
      // 2026-10-21 第四轮(P2-3)：授权此前只写本地 JSON——driver/locations 在 MySQL 模式以 MySQL 名单为准，
      // 专用接口的授权在生产可能不生效（此前靠管理弹窗 db/set 双写兜底）。补 MySQL 双写。
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['hubble_authorized_drivers', phone, JSON.stringify(dbData['hubble_authorized_drivers'][phone])]
        ).catch(() => {});
      }
      try { await logAdminOperation('hubble-authorize', requester, phone, '授予哈勃真名查看权限', req); } catch (_) {}
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
      // 2026-10-21 第四轮(P2-3)：撤销同步删 MySQL（与授权双写对齐）
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['hubble_authorized_drivers', phone]
        ).catch(() => {});
      }
      try { await logAdminOperation('hubble-revoke', requester, phone, '撤销哈勃真名查看权限', req); } catch (_) {}
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: String(e?.message || e) });
    }
  });

  // 5.3.1 阿里云服务器权威倒计时查询与同步接口 (专供司机接单新来单页面实时对齐服务器秒数)
  app.get(['/api/dispatch/countdown', '/api/order/countdown'], requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.query.orderId || req.query.id || req.query.orderNo || '').trim();
      const driverPhone = String(req.query.driverPhone || req.query.phone || '').replace(/\D/g, '').trim();

      const now = Date.now();
      // 2026-10-15根治：MySQL模式下从MySQL读订单，本地JSON是stale的会导致倒计时跳变（如56→33）
      let merchantOrders: Record<string, any> = {};
      let passengerLinks: Record<string, any> = {};
      if (isMySQLEnabled && mysqlPool) {
        try {
          // 2026-10-21 第四轮(性能)：此前每次轮询全表拉 merchant_orders+passenger_links 两张表，
          // 3000 司机容量目标下是放大点。带 orderId 的热路径先按 doc_id 定向取单，命中不扫全表；
          // 未命中才回退全表（orderNo 等别名匹配仍需扫）。passenger_links 只在按司机号回退时用，定向取即可。
          let moTargetedHit = false;
          if (orderId) {
            const [oneRow]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['merchant_orders', orderId]
            );
            if (oneRow && oneRow.length > 0) {
              const d = typeof oneRow[0].data === 'string' ? JSON.parse(oneRow[0].data) : oneRow[0].data;
              if (d) { merchantOrders[orderId] = d; moTargetedHit = true; }
            }
          }
          if (!moTargetedHit) {
            const [moRows]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
              ['merchant_orders']
            );
            (moRows || []).forEach((r: any) => {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              const k = String(r.doc_id || d?.id || d?.orderId || '').trim();
              if (k) merchantOrders[k] = d;
            });
          }
          if (driverPhone) {
            const [plRow]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['passenger_links', driverPhone]
            );
            if (plRow && plRow.length > 0) {
              const d = typeof plRow[0].data === 'string' ? JSON.parse(plRow[0].data) : plRow[0].data;
              if (d) passengerLinks[driverPhone] = d;
            }
          } else if (!moTargetedHit) {
            const [plRows]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
              ['passenger_links']
            );
            (plRows || []).forEach((r: any) => {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              const k = String(r.doc_id || '').trim();
              if (k) passengerLinks[k] = d;
            });
          }
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

      // 2026-10-23 第二十七轮：终态订单的倒计时直接报关闭。此前已取消/已完成的单仍按
      // dispatchedAt 继续算 60 秒倒计时（status 虽如实回 cancelled，但 isExpired=false、
      // 秒数递减），只看秒数的消费方会误以为派单还活着。终态口径与占用守卫共用
      // isTerminalOrderFact（status 终态集 ∪ isCancelled ∪ statusCategory）。
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
          isCancelled: targetOrder.isCancelled === true || targetOrder.status === 'cancelled',
          serverTime: now
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

      // 2026-10-22 第六轮：dispatchedAt 与 dispatchExpiresAt 双缺失时不再以 now 兜底虚构 60 秒
      // （旧兜底让无派单时间戳的单凭空多出整整一分钟，显示与服务端决策脱节）；按已过期语义返回，
      // 客户端已有兜底。仅缺其一时仍按另一值推导，保持既有行为。
      const rawDispatchedAt = Number(targetOrder.dispatchedAt || targetOrder.timestamp || 0);
      const rawExpiresAt = Number(targetOrder.dispatchExpiresAt || 0);
      if (!rawDispatchedAt && !rawExpiresAt) {
        return res.json({
          success: true,
          orderId: targetOrder.id || orderId,
          serverCountdown: 0,
          dispatchCountdown: 0,
          isExpired: true,
          inHall: targetOrder.in_hall === true || targetOrder.status === 'hall',
          status: targetOrder.status,
          dispatchedDriverPhone: '',
          serverTime: now,
          dispatchedAt: 0,
          dispatchExpiresAt: 0
        });
      }
      const dispatchedTime = rawDispatchedAt || (rawExpiresAt - 60000);
      let exp = rawExpiresAt || (dispatchedTime + 60000);

      // 2026-10-13按滴滴设计：删除 clientFirstSeenAt 重置逻辑。
      // 滴滴做法：60秒从派单时刻算起，不补时。用户晚10秒看到就显示50秒，显示真实剩余时间。
      // 此前"延迟10秒重置为60秒"的逻辑已删除。
      const remainingSec = Math.max(0, Math.ceil((exp - now) / 1000));

      // 2026-10-14诊断：记录每次倒计时返回，用于定位跳变问题
      // 如果看到同一 orderId 的 remainingSec 非单调递减，说明 exp 在变或找错了单
      if (process.env.COUNTDOWN_DEBUG === '1') {
        console.log(`[Countdown] orderId=${targetOrder.id || orderId} driver=${driverPhone} exp=${exp} now=${now} remaining=${remainingSec} status=${targetOrder.status}`);
      }

      // 2026-10-20 重构(P1)：接口已加鉴权；接单司机手机号只回相关方(被派/接单司机本人、下单侧)与管理层，
      // 防任意登录用户拿可枚举的订单号批量 harvest 司机手机号。
      // 2026-10-21 用户拍板：管理层（城市老板/城市管理/城市派单员）可见，回到第一轮「管理层可见」口径
      // （此前实现误把"管理员"收窄成仅开发者 isAdmin，城市管理层实际看不到，perms 实测抓到）。
      const cdReqPhone = String((req as any).authPhone || '').replace(/\D/g, '');
      const cdInvolved = [targetOrder.dispatchedDriverPhone, targetOrder.claimedDriverPhone, targetOrder.reporterPhone, targetOrder.merchantPhone, targetOrder.passengerPhone]
        .map((v: any) => String(v || '').replace(/\D/g, '')).filter(Boolean);
      let cdPhoneVisible = Boolean((req as any).isAdmin) || cdInvolved.includes(cdReqPhone);
      if (!cdPhoneVisible && cdReqPhone) {
        try {
          const cdMship: any = await getUnifiedMembership(cdReqPhone);
          const cdRole = String(cdMship?.role || '');
          const cdPos = String(cdMship?.squadPosition || '');
          cdPhoneVisible = !!cdMship?.isMember && (
            ['城市老板', '城市管理', '城市派单员'].some((r: string) => cdRole.includes(r)) ||
            ['boss', 'manager', 'dispatcher'].includes(cdPos)
          );
        } catch (_) {}
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
        dispatchedDriverPhone: cdPhoneVisible ? targetOrder.dispatchedDriverPhone : '',
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
        const staleLinkKeys: string[] = [];
        for (const [k, v] of Object.entries<any>(dbData['passenger_links'])) {
          // 2026-10-21 第四轮(P2-6)：updatedAt 常是 ISO 字符串，旧代码 Number(ISO)=NaN，这类文档永远清不掉；
          // 改为数字直接用、字符串走 Date.parse。
          // 2026-10-23 第二十六轮：补 cancelledAt——取消通知文档只有 cancelledAt、没有
          // timestamp/updatedAt，旧口径算出 0 永远跳过，这类文档永不过期（单槽残留）。
          const rawT: any = (v as any)?.timestamp ?? (v as any)?.updatedAt ?? (v as any)?.cancelledAt ?? 0;
          const time = typeof rawT === 'number' ? rawT : (Date.parse(String(rawT)) || 0);
          if (time > 0 && (now - time) > 48 * 3600 * 1000) {
            delete dbData['passenger_links'][k];
            staleLinkKeys.push(k);
            changed = true;
          }
        }
        if (changed) {
          writeLocalJsonDb(dbData);
        }
        // 2026-10-21 第四轮(P2-6)：此前只清 JSON——MySQL 模式下权威副本永不清理、canonical 读 MySQL
        // 优先等于没清。同步删 MySQL 同批条目。
        if (isMySQLEnabled && mysqlPool && staleLinkKeys.length > 0) {
          try {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` IN (?)',
              ['passenger_links', staleLinkKeys]
            );
          } catch (_) {}
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

      // 2026-10-20 重建：状态集合禁止 add（申请只走 /api/squad-apply，成员只走 approve 接口）
      if (['squad_members', 'squad_applications', 'team_members'].includes(col) && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '成员与申请状态只能通过专用接口变更', code: 'PROTECTED_COLLECTION' });
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
      // 2026-10-21 第三轮(P2-1)：db/add 此前漏了 driver_users 状态字段剥离（set/update 都有），
      // 普通用户可 add 整档覆盖写入 role/status/isBanned。与 set/update 同口径：非开发者一律剥离。
      if (col === 'driver_users' && !(req as any).isAdmin) {
        const STATE_FIELDS_ADD = ['status', 'approvalStatus', 'role', 'userRole', 'squad_position', 'position', 'is_squad_member', 'inSquad', 'isBanned'];
        for (const f of STATE_FIELDS_ADD) {
          if (data && typeof data === 'object' && f in data) delete data[f];
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
      // 2026-10-21 第四轮(P1-26)：online_applications 的 status/approvalStatus 此前可由司机本人经 add
      // 以自己手机号为 id 整档自封 'approved'（客户端弹窗直接读该字段判定已通过）。非开发者只允许
      // 待审类取值，其余一律剥离；审批结论只能由开发者或专用接口写入（set/update 同步此口径）。
      if (col === 'online_applications' && !(req as any).isAdmin && data && typeof data === 'object') {
        for (const f of ['status', 'approvalStatus']) {
          if (f in data) {
            const stV = String((data as any)[f] || '').trim();
            if (!['待审核', '待审批', 'pending', '未提交', ''].includes(stV)) {
              console.warn(`[Auth] online_applications ${f} 自写已剥离(add): token手机=${(req as any).authPhone}, 值=${stV}`);
              delete (data as any)[f];
            }
          }
        }
      }

      const generatedId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const dataWithId = { ...data, id: data.id || generatedId };
      const finalId = dataWithId.id;

      // 2026-10-23 第十六轮：add 同样适用 removed 在场守卫（add 可用 data.id 指定文档 id，
      // 与 set/update 同口径：removed 本人写自己两表且 isOnline=true 时强制置 false）。
      if ((col === 'driver_users' || col === 'driver_locations') && (dataWithId as any).isOnline === true) {
        const writerDigits = normalizeDriverPhoneUnified((req as any).authPhone);
        if (writerDigits && writerDigits === normalizeDriverPhoneUnified(finalId) && writerDigits !== DEVELOPER_PHONE_SERVER) {
          const removedSetW = await getRemovedSetCached5s();
          if (removedSetW.has(writerDigits)) (dataWithId as any).isOnline = false;
        }
      }

      if (isMySQLEnabled && mysqlPool) {
        // 2026-10-16修复：MySQL失败时直接抛错，不再静默回退到本地JSON（修系统消息假成功）
        const dataStr = JSON.stringify(dataWithId);
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          [col, finalId, dataStr]
        );
        // 2026-10-21 第四轮(P2-1)：add 此前 MySQL 成功即 return，JSON 镜像永久缺这类文档
        // （反馈/已读/走 add 的订单类），MySQL 故障回退 JSON 时整批消失。补镜像再返回。
        try {
          const jdb = readLocalJsonDb();
          if (!jdb[col]) jdb[col] = {};
          jdb[col][finalId] = dataWithId;
          writeLocalJsonDb(jdb);
        } catch (_) {}
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
  app.get('/api/download-dist', async (req, res) => {
    if (!(await verifyDeveloperDownload(req))) {
      return res.status(403).json({ success: false, error: '部署包下载需要开发者登录' });
    }
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
  app.get('/api/download-dist-tar', async (req, res) => {
    if (!(await verifyDeveloperDownload(req))) {
      return res.status(403).json({ success: false, error: '部署包下载需要开发者登录' });
    }
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


  // 2026-10-21 第三轮：微信扫码登录三接口（session/status/authorize）已整体下线。
  // 该功能从未接通任何登录消费方，authorize 却能无鉴权把任意手机号绑进会话——是颗哑弹，一并清除。

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
      // 2026-10-23 第二十六轮：改两段式——先两个键都检查通过、再统一记账。旧实现逐键
      // 「查完即记账」，手机号键先落账后 IP 键拒绝时，这次被拒的请求白白烧掉该号的小时配额
      // （同一 IP 反复被拒可把某号配额烧光而一条短信都没发出）。
      const pendingLogs: Array<[string, number[]]> = [];
      for (const key of [keyPhone, keyIp]) {
        const logs = (smsSendLogs.get(key) || []).filter((t) => now - t < 3600 * 1000);
        if (logs.length >= 5) {
          return res.status(429).json({ success: false, error: '❌ 发送过于频繁，请1小时后再试' });
        }
        if (logs.length > 0 && now - logs[logs.length - 1] < 60 * 1000) {
          const waitSec = Math.ceil((60 * 1000 - (now - logs[logs.length - 1])) / 1000);
          return res.status(429).json({ success: false, error: `❌ 发送过于频繁，请 ${waitSec} 秒后再试` });
        }
        pendingLogs.push([key, logs]);
      }
      for (const [key, logs] of pendingLogs) {
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
      // 2026-10-18 有状态鉴权：退出仅客户端清本地，服务端绑定永久保留。
      // 一号一token终身制，重登返回同一 token，不浪费短信包。服务端不再拉黑。
      return res.json({ success: true });
    } catch (e: any) {
      return res.json({ success: true });
    }
  });



  // 2026-10-21 第三轮：开发者专用 token 吊销——st_ 终身制此前无任何止损口，
  // token 泄露只能等换号。此接口删除 auth_tokens 的 p:/t: 双向映射并清内存 Map，
  // 目标设备下次请求即 401，重新短信登录会签发新 token。
  app.post('/api/admin/revoke-token', requireDbAuth, async (req: any, res: any) => {
    try {
      if (!(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '仅开发者可吊销 token' });
      }
      const rawTarget = String(req.body?.phone || '').trim().toUpperCase();
      const digits = rawTarget.replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(digits)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      if (digits === DEVELOPER_PHONE_SERVER) {
        return res.status(403).json({ success: false, error: '不能吊销开发者本人的 token' });
      }
      const targetPhone = rawTarget.endsWith('A') ? digits + 'A' : digits;
      let revokedToken = '';
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['auth_tokens', `p:${targetPhone}`]
          );
          if (rows && rows.length > 0) {
            const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            revokedToken = String(d?.token || '');
          }
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['auth_tokens', `p:${targetPhone}`]
          );
          if (revokedToken) {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['auth_tokens', `t:${revokedToken}`]
            );
          } else {
            // 兜底：p: 映射缺失时反扫 t: 映射按手机号找 token（防映射不全删不干净）
            const [tRows]: any = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` LIKE ?',
              ['auth_tokens', 't:%']
            );
            for (const row of (tRows || [])) {
              try {
                const td = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                if (td && String(td.phone || '') === targetPhone) {
                  revokedToken = String(row.doc_id).slice(2);
                  await mysqlPool.query(
                    'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                    ['auth_tokens', row.doc_id]
                  );
                  break;
                }
              } catch (_) {}
            }
          }
        } catch (e: any) {
          return res.status(500).json({ success: false, error: '吊销失败：' + (e?.message || e) });
        }
      }
      try {
        const dbData: any = readLocalJsonDb() || {};
        if (dbData.auth_tokens) {
          const pDoc = dbData.auth_tokens[`p:${targetPhone}`];
          if (pDoc && pDoc.token) revokedToken = String(pDoc.token);
          delete dbData.auth_tokens[`p:${targetPhone}`];
          if (revokedToken) {
            delete dbData.auth_tokens[`t:${revokedToken}`];
          } else {
            // 兜底反扫（同 MySQL 分支）
            for (const k of Object.keys(dbData.auth_tokens)) {
              if (k.startsWith('t:') && String(dbData.auth_tokens[k]?.phone || '') === targetPhone) {
                revokedToken = k.slice(2);
                delete dbData.auth_tokens[k];
                break;
              }
            }
          }
          writeLocalJsonDb(dbData);
        }
      } catch (_) {}
      if (revokedToken && authTokens.has(revokedToken)) {
        authTokens.delete(revokedToken);
        persistAuthTokensSync();
      }
      // 第四十二轮：同步失效 token 校验缓存，吊销立即生效（不等 60 秒 TTL）
      invalidatePersistentTokenCacheByPhone(targetPhone);
      await logAdminOperation('revoke-token', String((req as any).authPhone || ''), targetPhone, `吊销 ${targetPhone} 的登录token（终身制止损）`, req);
      return res.json({ success: true, revoked: !!revokedToken, phone: targetPhone });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e?.message || 'Revoke Error' });
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
    // 2026-10-23 第二十六轮：校验接口补 IP 维度防爆破（对所有号码一视同仁，含豁免号）。
    // 豁免铁律豁免的是「本人被限流/被锁定」，不是「任意来源的无限次猜码」：4 位码+5 分钟
    // 有效期下，旧实现对豁免号既不查锁定也不记失败，猜中即得终身 token。此限是网络层口径：
    // 同一 IP 10 分钟最多 30 次校验尝试——正常使用（本人输错重试）永远碰不到，不锁定手机号、
    // 不计入按号失败数；仅把远程爆破从「有效期内任意次」压到至多 30 次。
    {
      const vIp = getClientIp(req);
      const vKey = `ip:${vIp}`;
      const vNow = Date.now();
      const vLogs = (smsVerifyIpLogs.get(vKey) || []).filter((t) => vNow - t < 10 * 60 * 1000);
      if (vLogs.length >= 30) {
        return res.status(429).json({ success: false, error: '❌ 校验请求过于频繁，请稍后再试' });
      }
      vLogs.push(vNow);
      smsVerifyIpLogs.set(vKey, vLogs);
      if (smsVerifyIpLogs.size > 5000) {
        for (const [k2, v2] of smsVerifyIpLogs) {
          const fresh = v2.filter((t) => vNow - t < 10 * 60 * 1000);
          if (fresh.length === 0) smsVerifyIpLogs.delete(k2);
          else smsVerifyIpLogs.set(k2, fresh);
        }
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

        // 2026-10-18修：登录自动注册不再覆盖已有数据。
        // 原逻辑只查本地JSON，若本地无记录就造新的并 ON DUPLICATE KEY UPDATE 到 MySQL，
        // 会把管理员刚充的 VIP/授权天数覆盖成"待开通"。
        // 现改查 MySQL：MySQL 有记录则以 MySQL 为准（回写本地不同步覆盖）；两边都没有才新建。
        let mysqlExisting: any = null;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [mrows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['driver_users', cleanPhone]
            );
            if (mrows && mrows.length > 0) {
              mysqlExisting = typeof mrows[0].data === 'string' ? JSON.parse(mrows[0].data) : mrows[0].data;
            }
          } catch (_) {}
        }

        if (!existing && !mysqlExisting) {
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
        } else if (mysqlExisting && !existing) {
          // MySQL 有、本地无：回写本地，不覆盖 MySQL（保住管理员充的 VIP/授权）
          dbData.driver_users[cleanPhone] = mysqlExisting;
          writeLocalJsonDb(dbData);
        } else if (existing && !mysqlExisting && isMySQLEnabled && mysqlPool) {
          // 2026-10-21 第四轮：本地有、MySQL 无（如 MySQL 数据丢失/换机恢复后）——回填 MySQL。
          // 此前两条分支都不管这种情况，MySQL 优先读的接口会长期缺此人档案。INSERT IGNORE 只补缺、绝不覆盖。
          await mysqlPool.query(
            'INSERT IGNORE INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?)',
            ['driver_users', cleanPhone, JSON.stringify(existing)]
          ).catch(() => {});
        }
      } catch (regErr) {
        console.error('[Auto Register Driver User Error]:', regErr);
      }

      // 签发认证令牌：用于后续 /api/db/* 写操作鉴权
      // 商户网页版（scope=dispatch_valet）登录时，token 的 phone 带 A 后缀，与司机身份隔离
      // 2026-10-18 改为有状态 st_ token（一号一token终身制，见下方 getOrCreatePersistentToken）；无状态 v1 已于 2026-10-21 下线
      const tokenScope = scope || (isAdminLogin ? 'admin_panel' : 'driver');
      const isMerchantLogin = String(scope || '').trim() === 'dispatch_valet';
      const tokenPhone = isMerchantLogin ? String(cleanPhone || '').trim().toUpperCase() + 'A' : cleanPhone;
      // 2026-10-18 有状态鉴权：一号一token终身制。已绑定则返回同一 token，未绑定则生成并持久化到 MySQL。
      // 退出/重装/重登不换 token，不浪费短信包。
      const authToken = await getOrCreatePersistentToken(tokenPhone, tokenScope, isMerchantLogin);
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
      // 同一 st_ token 同步写入内存 Map 作会话缓存（requireDbAuth 的回退校验路）
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
    // 2026-10-22 第六轮：Firestore 时代一次性迁移工具下线。原实现触发即以本地 JSON 快照
    // 整表覆盖 MySQL 六集合、并为每个手机号补建档案，是高危运维残留（照 purge-all-drivers 先例改 410）。
    return res.status(410).json({ success: false, error: '该迁移接口已下线' });
  });

  // Passenger Order submission redirect (from older config files and direct Cloudflare support endpoint)
  app.post('/api/submit', async (req, res) => {
    // 2026-10-21 第三轮：/api/submit 无鉴权遗留接口下线。乘客自助早已改走 /api/qr-phone-notify
    // （只通知不建单），现行客户端无调用（仅剩小程序模拟器的 fallback，已同步删除）。
    // 此接口靠 IP 限流兜底，知道某 VIP 司机手机号即可匿名给他造订单弹窗，不再保留。
    // 2026-10-22 第六轮：410 之后约 140 行不可达旧匿名建单 handler 尸体已整段删除，防误接回复活。
    return res.status(410).json({ success: false, error: '该接口已下线' });
  });

  // 2026-10-22 第十一轮：乘客落地页公开信息端点（无鉴权，只读最小字段）。
  // 背景：passenger_order.html 原靠 /api/db/get 查司机 vipExpiry 做服务端校验，
  // 该接口 2026-10-18 鉴权收口后乘客（无 token）恒 401，服务端校验通道实际已死，
  // 页面只剩 URL 自带 vip 参数可被随手改（React 版 P0-2 已修、静态页未跟上）。
  // 本端点只返回页面门禁真正需要的三个字段（是否存在/VIP 到期/品牌名），
  // 不返回真实姓名、位置、联系方式以外的任何档案数据；/api/db/get 鉴权口径不变。
  app.get('/api/passenger/link-info', async (req, res) => {
    try {
      const driver = String(req.query.driver || req.query.phone || '').replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(driver)) {
        return res.status(400).json({ success: false, error: '司机手机号格式错误' });
      }
      const doc = (await readStatusDocument('driver_users', driver)) || (await readStatusDocument('squad_members', driver));
      if (!doc) {
        return res.json({ success: true, exists: false });
      }
      const { vipExpiry } = await readDriverExpiryUnified(driver);
      const brandName = String(doc.customAppName || doc.driverBrandName || '').trim();
      return res.json({ success: true, exists: true, vipExpiry: vipExpiry || doc.vipExpiry || '待开通', brandName });
    } catch (err) {
      return res.status(500).json({ success: false, error: '查询失败' });
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
        // 2026-10-22 第六轮：VIP 读取改走统一口径（squad_members 权威优先、driver_users 兜底）
        const vipExpiry = (await readDriverExpiryUnified(targetPhone)).vipExpiry;
        if (!isVipActiveServer(vipExpiry)) {
          return res.status(403).json({ success: false, error: '二维码创单为VIP专属功能，请先开通VIP' });
        }
      } catch (e) {
        console.error('[QRNotify] VIP校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '校验失败，请重试' });
      }
      const { driverPhone, passengerPhone, startLocation } = req.body || {};
      if (!driverPhone || !passengerPhone) {
        return res.status(400).json({ success: false, error: '缺少必填参数' });
      }

      const cleanDriverPhone = String(driverPhone).replace(/\D/g, '').trim();
      const cleanPassengerPhone = String(passengerPhone).replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(cleanDriverPhone) || !/^1[3-9]\d{9}$/.test(cleanPassengerPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      // IP限流：与 /api/submit 同级，防批量骚扰。
      // 2026-10-21 第四轮：记账后移到参数校验之后——旧顺序下无效请求也消耗 3 次/分钟配额。
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

      // 2026-10-21 第四轮：通知改存独立集合 qr_notifications。passenger_links 是派单载荷的单槽邮箱，
      // 通知整档覆盖会把司机正弹出的派单载荷顶掉（订单本体还在，但弹窗/倒计时回退会读到通知文档）。
      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(payloadData);
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['qr_notifications', cleanDriverPhone, dataStr]
        );
        // 注意：不写入 merchant_orders，不建单、不派单
        return res.json({ success: true, timestamp: Date.now() });
      }

      const dbData = readLocalJsonDb();
      if (!dbData.qr_notifications) dbData.qr_notifications = {};
      dbData.qr_notifications[cleanDriverPhone] = payloadData;
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
      let payloadSource = 'qr_notifications';

      // 2026-10-21 第四轮：先读独立集合 qr_notifications；未命中再回退 passenger_links 兼容部署前残留通知。
      if (isMySQLEnabled && mysqlPool) {
        for (const colTry of ['qr_notifications', 'passenger_links']) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [colTry, driverPhone]
          );
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed && parsed.type === 'qr_phone_notify') { payloadData = parsed; payloadSource = colTry; break; }
          }
        }
      } else {
        const dbData = readLocalJsonDb();
        const fromNew = dbData?.qr_notifications?.[driverPhone];
        if (fromNew && fromNew.type === 'qr_phone_notify') {
          payloadData = fromNew;
        } else {
          payloadData = dbData?.passenger_links?.[driverPhone] || null;
          payloadSource = 'passenger_links';
        }
      }

      // 只返回有效的二维码通知：type=qr_phone_notify, status=submitted, 5分钟内
      if (payloadData && payloadData.type === 'qr_phone_notify' &&
          payloadData.status === 'submitted' &&
          payloadData.timestamp > Date.now() - 300000) {
        // 取走后立即删除，防止重复投递
        try {
          if (isMySQLEnabled && mysqlPool) {
            // 2026-10-21 第四轮：删除带 timestamp 条件——读与删之间若恰有新通知写入，不许把新通知一并删掉
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? AND CAST(JSON_EXTRACT(`data`, \'$.timestamp\') AS UNSIGNED) = ?',
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
          // 写三表 vipExpiry（读当前值累加）——第十九轮：先确认确有司机档案再烧码
          // （同 JSON 分支：无档案兑换旧口径会烧码且返回空 vipExpiry 的假成功）。
          const purePhone = redeemerPhone.replace(/A$/, '');
          let creditedMysql = false;
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
                creditedMysql = true;
              }
            }
          }
          if (!creditedMysql || !finalExpiry) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ success: false, error: '当前账号没有司机档案，无法兑换' });
          }
          foundData.isRedeemed = true;
          foundData.redeemedAt = new Date().toISOString();
          foundData.redeemedBy = redeemerPhone;
          await conn.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['vip_codes', cleanCode, JSON.stringify(foundData)]
          );
          await conn.commit(); conn.release();
          // 2026-10-21 第四轮(P2-2)：兑换此前只写 MySQL 不镜像 JSON——vip-status 等读 JSON 的路径
          // 兑换后仍显示旧值；回退 JSON 模式时兑换码还会呈未兑换、可二次兑换。提交后镜像码状态与三表有效期。
          try {
            const jdb = readLocalJsonDb();
            if (!jdb.vip_codes) jdb.vip_codes = {};
            jdb.vip_codes[cleanCode] = foundData;
            const pureP2 = redeemerPhone.replace(/A$/, '');
            for (const col of ['driver_users', 'squad_members', 'online_applications']) {
              for (const p of [redeemerPhone, pureP2]) {
                if (jdb[col]?.[p] && finalExpiry) {
                  jdb[col][p].vipExpiry = finalExpiry;
                  jdb[col][p].updatedAt = new Date().toISOString();
                }
              }
            }
            writeLocalJsonDb(jdb);
          } catch (_) {}
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
        // 2026-10-23 第十九轮：先确认兑换人确有司机档案再烧码。旧口径先标记已兑换再找
        // 档案——商户 A 身份（token 解析为纯数字）或无档案账号兑换时，码被烧掉、接口却
        // 返回 success+空 vipExpiry，司机什么都没得到（实测复现）。
        const purePhone = redeemerPhone.replace(/A$/, '');
        let creditedJson = false;
        for (const col of ['driver_users', 'squad_members', 'online_applications']) {
          for (const p of [redeemerPhone, purePhone]) {
            if (dbData[col]?.[p]) {
              if (!finalExpiry) finalExpiry = calcExpiry(String(dbData[col][p].vipExpiry || ''), durationDays);
              dbData[col][p].vipExpiry = finalExpiry;
              dbData[col][p].updatedAt = new Date().toISOString();
              creditedJson = true;
            }
          }
        }
        if (!creditedJson || !finalExpiry) {
          return res.status(400).json({ success: false, error: '当前账号没有司机档案，无法兑换' });
        }
        foundData.isRedeemed = true;
        foundData.redeemedAt = new Date().toISOString();
        foundData.redeemedBy = redeemerPhone;
        if (!dbData.vip_codes) dbData.vip_codes = {};
        dbData.vip_codes[cleanCode] = foundData;
        writeLocalJsonDb(dbData);
      }
      return res.json({ success: true, vipExpiry: finalExpiry, durationDays });
    } catch (err: any) {
      console.error('[VIP Code Redeem] error:', err);
      res.status(500).json({ success: false, error: err.message || 'VIP Code Redeem Error' });
    }
  });

  // 2026-10-12 新来单超时/拒收转大厅专用通道：不走鉴权，秒级进厅
  app.post('/api/order/to-hall', requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, reason } = req.body || {};
      const cleanOrderId = String(orderId || '').trim();
      // P0-2修复(2026-10-14)：driverPhone 取自 token 不信任请求体（防伪造别人手机号）；且必须是该订单的被派司机才能转大厅
      const cleanDriverPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: '缺少 orderId' });
      }
      let hallValidationFailed = false;
      let hallOrderMissing = false;
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
          } else {
            hallOrderMissing = true;
          }
        }
      } catch (_) { hallValidationFailed = true; }
      // 2026-10-20 重构(P1)：归属校验改 fail-closed——校验出错或订单不存在一律不写，
      // 此前异常被 catch 吞掉后照样执行、对不存在的订单还以 {} 为底稿造大厅空壳。
      if (hallValidationFailed) {
        return res.status(500).json({ success: false, error: '订单校验失败，请重试' });
      }
      if (hallOrderMissing) {
        return res.status(404).json({ success: false, error: '订单不存在' });
      }
      if ((req as any).isAdmin) {
        const devExisting = (await Promise.resolve(readCanonicalDocument('merchant_orders', cleanOrderId))) || (await Promise.resolve(readCanonicalDocument('valet_orders', cleanOrderId)));
        if (!devExisting) {
          return res.status(404).json({ success: false, error: '订单不存在' });
        }
      }
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
          timeoutDriverPhones: existingTimeout, // 2026-10-20 重构(P2)：拒单/转大厅只记 declined 名单，timeout 名单只由服务端扫单写入
          lastDeclinedAt: now,
          hallReason: String(reason || 'timeout_or_decline').slice(0, 50),
          hallAt: Date.now(),
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
        // 2026-10-23 第二十五轮：MySQL 分支此前不刷 JSON 镜像，镜像长期停在 dispatched 态，
        // db/get 回退、05:59 清理等读镜像路径会吃到旧态。与其它写路径同口径补镜像同步。
        try {
          const jdb2 = readLocalJsonDb();
          if (!jdb2['merchant_orders']) jdb2['merchant_orders'] = {};
          const jm = jdb2['merchant_orders'][cleanOrderId] || {};
          jdb2['merchant_orders'][cleanOrderId] = applyToOrder(jm);
          if (cleanDriverPhone && jdb2['passenger_links']?.[cleanDriverPhone]) {
            delete jdb2['passenger_links'][cleanDriverPhone];
          }
          writeLocalJsonDb(jdb2);
        } catch (_) {}
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

  // 2026-10-21 第二轮修复(P1)：行程状态推进专用接口（司机到达 arrived / 服务中 serving）。
  // 此前由开单页客户端直写 merchant_orders，但写目标是订单号、过不了鉴权中间层的本人归属校验，
  // 这两个状态从来没真正落库（司机端本地看得到、服务端与派单台永远收不到）。现由服务端按归属推进。
  app.post('/api/order/progress', requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, stage } = req.body || {};
      const cleanOrderId = String(orderId || '').trim();
      if (!cleanOrderId || (stage !== 'arrived' && stage !== 'serving')) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      const requester = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const found: Record<string, any> = {};
      for (const col of ['merchant_orders', 'valet_orders']) {
        const doc = await Promise.resolve(readCanonicalDocument(col, cleanOrderId));
        if (doc) found[col] = doc;
      }
      const foundCols = Object.keys(found);
      if (foundCols.length === 0) {
        return res.status(404).json({ success: false, error: '订单不存在' });
      }
      const order = found[foundCols[0]];
      const assigned = String(order.claimedDriverPhone || order.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
      if (!(req as any).isAdmin && assigned !== requester) {
        return res.status(403).json({ success: false, error: '只有接单司机可以推进该订单状态' });
      }
      const oStatus = String(order.status || '');
      const oCat = String(order.statusCategory || '');
      if (['completed', '已完成', 'cancelled', '已取消'].includes(oStatus) || ['已完成', '已取消'].includes(oCat)) {
        return res.status(409).json({ success: false, error: '订单已完结，不能推进状态' });
      }
      // 2026-10-22 第七轮收尾审计：状态前置——订单必须已被接单（claimedDriverPhone 非空且状态在
      // 已接单/已到达/服务中集合内）才能推进。旧实现仅凭 dispatchedDriverPhone 即可把一笔未接单的
      // 派单直接推到 serving：绕过 claim 全部守卫、释放未决占用且不置行程忙碌，可一人两单并一路完单。
      {
        const claimedBy = String(order.claimedDriverPhone || '').replace(/\D/g, '').trim();
        const progressable = ['claimed', '已接单', 'arrived', '司机到达', 'serving', '服务中'];
        if (!claimedBy || !progressable.includes(oStatus)) {
          return res.status(409).json({ success: false, error: '订单尚未接单，无法推进状态' });
        }
      }
      const now = Date.now();
      const patch = stage === 'arrived'
        ? { status: 'arrived', statusCategory: '司机到达', arrivedAt: now, updatedAt: now }
        : { status: 'serving', statusCategory: '服务中', servingAt: now, updatedAt: now };
      for (const col of foundCols) {
        const updated = { ...found[col], ...patch };
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, cleanOrderId, JSON.stringify(updated)]);
        }
        try {
          const dbData = readLocalJsonDb();
          if (dbData[col]?.[cleanOrderId]) {
            dbData[col][cleanOrderId] = updated;
            writeLocalJsonDb(dbData);
          }
        } catch (_) {}
      }
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Order Progress] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Order Progress Error' });
    }
  });

  // 2026-10-12 行程中司机确认取消专用通道：真取消，不进大厅，不再弹窗
  app.post('/api/order/true-cancel', requireDbAuth, orderLockMiddleware, async (req, res) => {
    try {
      const { orderId, driverPhone, reason } = req.body || {};
      const cleanOrderId = String(orderId || '').trim();
      const cleanDriverPhone = String(driverPhone || '').replace(/\D/g, '').trim();
      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: '缺少 orderId' });
      }
      const now = Date.now();
      // 2026-10-20 重构(P0)：真取消必须验归属。此前 orderId/driverPhone 全取请求体、零校验，
      // 任意登录司机可取消他人订单并删其 passenger_links，还能对不存在订单造 cancelled 空壳。
      // 现行规则：接单/被派司机本人、下单方、管理人员(统一口径)三类可取消；订单不存在 404 不造壳；
      // 留痕字段(cancelledBy 等)一律服务端按调用者身份生成，不信请求体。
      const tcRequester = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const tcExisting: Record<string, any> = {};
      for (const col of ['merchant_orders', 'valet_orders']) {
        const doc = await Promise.resolve(readCanonicalDocument(col, cleanOrderId));
        if (doc) tcExisting[col] = doc;
      }
      const tcCols = Object.keys(tcExisting);
      if (tcCols.length === 0) {
        return res.status(404).json({ success: false, error: '订单不存在' });
      }
      const tcOrder = tcExisting[tcCols[0]];
      const tcDriverPhone = String(tcOrder.claimedDriverPhone || tcOrder.dispatchedDriverPhone || '').replace(/\D/g, '').trim();
      const tcCreators = [tcOrder.reporterPhone, tcOrder.merchantPhone, tcOrder.orderPhone]
        .map((v: any) => String(v || '').replace(/\D/g, '').trim()).filter(Boolean);
      let tcRole = '';
      if ((req as any).isAdmin) tcRole = 'admin';
      else if (tcDriverPhone && tcRequester === tcDriverPhone) tcRole = 'driver';
      else if (tcCreators.includes(tcRequester)) tcRole = 'merchant';
      else {
        let tcMember: any = null;
        try { tcMember = await Promise.resolve(getUnifiedMembership(tcRequester)); } catch (_) {}
        if (tcMember && tcMember.isMember && ['城市老板', '城市管理', '城市派单员', '开发者'].some(r => String(tcMember.role || '').includes(r))) tcRole = 'admin';
      }
      if (!tcRole) {
        return res.status(403).json({ success: false, error: '只有接单司机、下单方或管理人员可以取消该订单' });
      }
      // 2026-10-23 第二十六轮：补终态守卫——已完成订单不许被真取消翻成 cancelled
      // （/api/order/cancel 早有此守卫，本通道独缺；翻活会连带非 VIP 日完单计数变化）。
      // 已取消单重复取消保持幂等放行。
      if (['completed', '已完成', 'finished'].includes(String(tcOrder.status || '')) ||
          String(tcOrder.statusCategory || '') === '已完成') {
        return res.status(409).json({ success: false, error: '订单已完成，无法取消' });
      }
      const cancelPayload = {
        status: 'cancelled',
        statusCategory: '已取消',
        in_hall: false,
        isCancelled: true,
        cancelledAt: now,
        cancelledBy: tcRole,
        cancelledByRole: tcRole,
        cancelledByPhone: tcRequester,
        cancelledDriverPhone: tcDriverPhone,
        cancelReason: String(reason || '司机已取消订单').slice(0, 100),
      };
      const applyCancel = (targetOrder: any) => ({ ...(targetOrder || {}), ...cancelPayload });
      if (isMySQLEnabled && mysqlPool) {
        for (const col of tcCols) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, cleanOrderId, JSON.stringify(applyCancel(tcExisting[col]))]
          ).catch((e: any) => console.error('[TrueCancel] 订单写入失败:', col, cleanOrderId, e?.message));
        }
        if (tcDriverPhone) {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['passenger_links', tcDriverPhone]
          ).catch((e: any) => console.error('[TrueCancel] 删除乘客链接失败:', tcDriverPhone, e?.message));
          // 2026-10-22 第八轮：真取消必须同步清进行中订单与司机忙碌（与 /api/order/cancel 口径对齐）。
          // 旧实现只改订单状态：已接单被真取消后司机 isBusy 永不清、active_orders 残留，
          // 司机被永久误判行程中（edge E2b 三态根源之一）。仅当进行中订单就是本单时才清，
          // 指向其他行程时不动，防误清新单忙碌。
          try {
            const [arows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['active_orders', tcDriverPhone]
            );
            const aDoc = arows && arows.length > 0 ? (typeof arows[0].data === 'string' ? JSON.parse(arows[0].data) : arows[0].data) : null;
            const aOrderId = String(aDoc?.orderId || aDoc?.id || '').trim();
            if (!aDoc || aOrderId === cleanOrderId) {
              await mysqlPool.query(
                'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                ['active_orders', tcDriverPhone]
              ).catch(() => {});
              for (const col of ['driver_locations', 'driver_users', 'squad_members']) {
                try {
                  const [drows]: any = await mysqlPool.query(
                    'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                    [col, tcDriverPhone]
                  );
                  if (drows && drows.length > 0) {
                    const dd = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
                    dd.isBusy = false;
                    dd.lastStatusUpdateTime = Date.now();
                    await mysqlPool.query(
                      'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                      [JSON.stringify(dd), col, tcDriverPhone]
                    );
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
        // 2026-10-23 第二十六轮：MySQL 分支补刷 JSON 镜像（与 to-hall 同口径）。旧实现真取消
        // 只写 MySQL，镜像里该单长期停在取消前状态，MySQL 故障切 JSON 模式会原样复活。
        try {
          const jdb = readLocalJsonDb();
          for (const col of tcCols) {
            if (!jdb[col]) jdb[col] = {};
            jdb[col][cleanOrderId] = applyCancel(jdb[col][cleanOrderId] || tcExisting[col]);
          }
          if (tcDriverPhone) {
            if (jdb['passenger_links']?.[tcDriverPhone]) delete jdb['passenger_links'][tcDriverPhone];
            const aDocJ = jdb['active_orders']?.[tcDriverPhone];
            const aOrderIdJ = String(aDocJ?.orderId || aDocJ?.id || '').trim();
            if (!aDocJ || aOrderIdJ === cleanOrderId) {
              if (jdb['active_orders']) delete jdb['active_orders'][tcDriverPhone];
              for (const col of ['driver_locations', 'driver_users', 'squad_members']) {
                if (jdb[col]?.[tcDriverPhone]) {
                  jdb[col][tcDriverPhone] = { ...jdb[col][tcDriverPhone], isBusy: false, lastStatusUpdateTime: now };
                }
              }
            }
          }
          writeLocalJsonDb(jdb);
        } catch (_) {}
      } else {
        const dbData = readLocalJsonDb();
        for (const col of tcCols) {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][cleanOrderId] = applyCancel(tcExisting[col]);
        }
        if (tcDriverPhone && dbData['passenger_links'] && dbData['passenger_links'][tcDriverPhone]) {
          delete dbData['passenger_links'][tcDriverPhone];
        }
        // 2026-10-22 第八轮：同 MySQL 分支——清进行中订单与忙碌（仅当进行中订单就是本单）
        if (tcDriverPhone) {
          const aDoc = dbData['active_orders']?.[tcDriverPhone];
          const aOrderId = String(aDoc?.orderId || aDoc?.id || '').trim();
          if (!aDoc || aOrderId === cleanOrderId) {
            if (dbData['active_orders']) delete dbData['active_orders'][tcDriverPhone];
            for (const col of ['driver_locations', 'driver_users', 'squad_members']) {
              if (dbData[col]?.[tcDriverPhone]) {
                dbData[col][tcDriverPhone] = { ...dbData[col][tcDriverPhone], isBusy: false, lastStatusUpdateTime: now };
              }
            }
          }
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
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不是司机，不能执行此操作' });
      }
      const cleanName = String(name || '').trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanName) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      // 2026-10-23 第二十一轮(M1)：审批必须有事实前置——存在入队申请记录或已是成员
      // （重审修复）。旧口径对任意 11 位号码无条件造人：最低档管理（派单员）可绕过
      // 申请环节直接 mint 成员；被移除者因 remove 已删其申请记录，也必须先重新申请
      // 才能被审批恢复（与「申请是唯一申请事实」的口径一致）。
      {
        const appDocForApprove = await Promise.resolve(readStatusDocument('squad_applications', cleanPhone)).catch(() => null);
        const memberDocForApprove = await Promise.resolve(readStatusDocument('squad_members', cleanPhone)).catch(() => null);
        if (!appDocForApprove && !memberDocForApprove) {
          return res.status(400).json({ success: false, error: '该司机没有入队申请记录，不能直接审批（请先让司机提交申请）' });
        }
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
        // 2026-10-20 重建：角色保留改读权威成员记录（MySQL 优先），不再只读本地 JSON
        const existing = (await readStatusDocument('squad_members', cleanPhone)) || readLocalJsonDb().squad_members?.[cleanPhone] || null;
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
        vipExpiry: keepVipExpiry, licenseExpiry: keepLicenseExpiry, is_squad_member: 1, inSquad: true, createdAt: nowTs, updatedAt: now,
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
          const teamPayload = { ...memberPayload, squad_position: squadPositionCodeFromRole(keepRole), joinedAt: now };
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
        // 2026-10-20 重建：MySQL 分支同步本地 JSON，防旧本地数据造成状态分叉（复活/误拦）
        syncLocalApprove(cleanPhone, memberPayload);
        // 2026-10-22 第八轮：MySQL 侧定位同步恢复在线（remove 时标的离线在此成对恢复）
        try {
          const [alRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_locations', cleanPhone]);
          if (alRows && alRows.length > 0) {
            const ald = typeof alRows[0].data === 'string' ? JSON.parse(alRows[0].data) : alRows[0].data;
            ald.isOnline = true;
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
              [JSON.stringify(ald), 'driver_locations', cleanPhone]);
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
        dbData['team_members'][cleanPhone] = { ...memberPayload, squad_position: squadPositionCodeFromRole(keepRole), joinedAt: now };
        if (dbData['squad_applications']?.[cleanPhone]) delete dbData['squad_applications'][cleanPhone];
        if (dbData['driver_locations']?.[cleanPhone]) dbData['driver_locations'][cleanPhone] = { ...dbData['driver_locations'][cleanPhone], isOnline: true }; // 2026-10-22 第八轮：重加恢复在线
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
      try { await logAdminOperation('approve', String((req as any).authPhone || ''), cleanPhone, '审批通过加入小队', req); } catch (_) {}
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Approve] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Approve Error' });
    }
  });

  // 2026-10-18 新增：拒绝小队申请专用接口。之前管理后台走 /api/db/set 直接写，
  // 非开发者管理人员（isManager/isDispatcher）写他人文档会被 403 拦截，导致点拒绝没反应。
  // 权限口径与 approve 一致：管理员/管理人员/城市派单员可拒绝。
  app.post('/api/squad-member/reject', requireDbAuth, async (req, res) => {
    try {
      const isApproverAdmin = (req as any).isAdmin || (req as any).isManager || (req as any).isDispatcher;
      if (!isApproverAdmin) {
        return res.status(403).json({ success: false, error: '仅管理人员可以拒绝申请' });
      }
      const { phone, reason } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不是司机，不能执行此操作' });
      }
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      const now = new Date().toISOString();
      const realRejecter = String((req as any).authPhone || '').trim();
      const finalReason = String(reason || '').trim().slice(0, 200) || '申请信息不符合小队要求，请完善后重新申请。';
      const rejectData = {
        status: '已拒绝',
        approvalStatus: '已拒绝',
        rejectedBy: realRejecter,
        rejectionReason: finalReason,
        rejectionTime: now,
        updatedAt: now,
      };
      // 2026-10-20 重建：拒绝前必须校验申请真实存在且处于待审核，不再凭空造“已拒绝壳”
      const existingAppDoc = await readStatusDocument('squad_applications', cleanPhone);
      if (!existingAppDoc) {
        return res.status(404).json({ success: false, error: '申请不存在' });
      }
      const existingAppStatus = String(existingAppDoc.status || existingAppDoc.approvalStatus || '').trim();
      if (existingAppStatus === '已拒绝') {
        return res.json({ success: true, alreadyRejected: true });
      }
      if (!['待审核', 'pending', '审核中'].includes(existingAppStatus)) {
        return res.status(409).json({ success: false, error: '当前申请状态不可拒绝' });
      }
      const membershipForReject = await getUnifiedMembership(cleanPhone);
      if (membershipForReject.isMember) {
        return res.status(409).json({ success: false, error: '该司机已是小队成员' });
      }
      if (isMySQLEnabled && mysqlPool) {
        // 读现有申请保留姓名等字段，merge 更新状态
        let existing: any = {};
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['squad_applications', cleanPhone]
          );
          if (rows && rows.length > 0) {
            const raw = rows[0].data;
            existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
        } catch (_) {}
        const merged = { ...existing, ...rejectData, phone: cleanPhone };
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['squad_applications', cleanPhone, JSON.stringify(merged)]
        );
        syncLocalReject(cleanPhone, merged);
      } else {
        const dbData: any = readLocalJsonDb() || {};
        if (!dbData.squad_applications) dbData.squad_applications = {};
        const existing = dbData.squad_applications[cleanPhone] || {};
        dbData.squad_applications[cleanPhone] = { ...existing, ...rejectData, phone: cleanPhone };
        writeLocalJsonDb(dbData);
      }
      try { await logAdminOperation('reject', String((req as any).authPhone || ''), cleanPhone, '拒绝入队申请', req); } catch (_) {}
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Reject] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Reject Error' });
    }
  });

  // 2026-10-22 第六轮：线上单资质审批专用接口（管理后台 A5 批配套）。
  // 此前管理后台客户端直写 online_applications.status + driver_users.onlineOrdersEnabled 两表：
  // 非豁免身份时服务端剥离状态字段却仍返回 200，出现「提示成功、实际没生效」的假成功。
  // 鉴权口径与 /api/squad-member/approve 一致（开发者或管理层成员；角色推导已验成员状态+removed）。
  // 写值与旧客户端直写保持兼容：approve -> status:'approved' + onlineOrdersEnabled:true；
  // reject -> status:'rejected' + rejectionReason + onlineOrdersEnabled:false。双写 MySQL+本地 JSON。
  const handleOnlineApplicationDecision = async (req: any, res: any, approve: boolean) => {
    try {
      const isApproverAdmin = (req as any).isAdmin || (req as any).isManager || (req as any).isDispatcher;
      if (!isApproverAdmin) {
        return res.status(403).json({ success: false, error: '仅管理人员可以审批线上单资质' });
      }
      const { phone, reason } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      const existingApp = await readCanonicalDocument('online_applications', cleanPhone);
      if (!existingApp) {
        return res.status(404).json({ success: false, error: '申请不存在' });
      }
      const now = new Date().toISOString();
      const operator = String((req as any).authPhone || '').trim();
      const appUpdated: any = {
        ...existingApp,
        phone: cleanPhone,
        status: approve ? 'approved' : 'rejected',
        approvalStatus: approve ? 'approved' : 'rejected',
        updatedAt: now,
      };
      if (approve) {
        appUpdated.approvedBy = operator;
        appUpdated.approvalTime = now;
      } else {
        appUpdated.rejectedBy = operator;
        appUpdated.rejectionReason = String(reason || '').trim().slice(0, 200) || '信息资质核验存在偏差，请重新提交高清合规证照。';
        appUpdated.rejectionTime = now;
      }
      // driver_users 仅在档案已存在时回写开关（existing-only，不凭空建壳，与 H5 口径一致）
      const existingDriver = await readCanonicalDocument('driver_users', cleanPhone);
      const driverUpdated: any = (existingDriver && Object.keys(existingDriver).length > 0) ? {
        ...existingDriver,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        onlineOrdersEnabled: approve,
        updatedAt: now,
      } : null;
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['online_applications', cleanPhone, JSON.stringify(appUpdated)]);
        if (driverUpdated) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['driver_users', cleanPhone, JSON.stringify(driverUpdated)]);
        }
      }
      // 双写本地 JSON（与专用接口惯例一致，防双存储分叉）
      try {
        const dbData = readLocalJsonDb();
        if (!dbData.online_applications) dbData.online_applications = {};
        dbData.online_applications[cleanPhone] = appUpdated;
        if (driverUpdated) {
          if (!dbData.driver_users) dbData.driver_users = {};
          dbData.driver_users[cleanPhone] = driverUpdated;
        }
        writeLocalJsonDb(dbData);
      } catch (_) {}
      try { await logAdminOperation(approve ? 'online-approve' : 'online-reject', operator, cleanPhone, approve ? '线上单资质审批通过' : '线上单资质驳回', req); } catch (_) {}
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Online Application Decision] error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Online Application Error' });
    }
  };
  app.post('/api/online-application/approve', requireDbAuth, (req, res) => handleOnlineApplicationDecision(req, res, true));
  app.post('/api/online-application/reject', requireDbAuth, (req, res) => handleOnlineApplicationDecision(req, res, false));

  // 2026-10-12 司机改名专用通道：同步更新所有相关表。不走鉴权。
  app.post('/api/squad-member/rename', requireDbAuth, async (req, res) => {
    try {
      // P0-1修复(2026-10-15)：仅管理人员可改名，防普通司机越权
      if (!(req as any).isAdmin && !(req as any).isManager) {
        return res.status(403).json({ success: false, error: '仅管理人员可以改名' });
      }
      const { phone, name } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不是司机，不能执行此操作' });
      }
      const cleanName = String(name || '').trim().slice(0, 8);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanName) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      // 2026-10-20 重构(H2)：目标保护——非开发者不得改开发者姓名；改他人姓名须等级严格高于目标（此前只有派单台客户端有此规则，API 直调可绕过）
      const operatorPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (cleanPhone === '15509601222' && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '开发者姓名不可修改' });
      }
      if (cleanPhone !== operatorPhone && !(req as any).isAdmin) {
        const targetM: any = await Promise.resolve(getUnifiedMembership(cleanPhone)).catch(() => null);
        const operatorM: any = await Promise.resolve(getUnifiedMembership(operatorPhone)).catch(() => null);
        if (membershipLevelUnified(targetM) >= membershipLevelUnified(operatorM)) {
          return res.status(403).json({ success: false, error: '不能修改同级或上级成员的姓名' });
        }
      }
      const now = new Date().toISOString();
      const updatePayload = { name: cleanName, driverName: cleanName, realName: cleanName, applicantName: cleanName, updatedAt: now };
      const cols = ['squad_members', 'driver_users', 'driver_locations', 'online_applications', 'squad_applications', 'team_members'];
      let syncFailures = 0;
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
          } catch (_) { syncFailures++; }
        }
        // 2026-10-20 重构(H3)：补本地 JSON 双写，防走 JSON 兜底的读路径长期显示旧名
        try {
          const dbData = readLocalJsonDb();
          for (const col of cols) {
            if (dbData[col]?.[cleanPhone]) {
              dbData[col][cleanPhone] = { ...dbData[col][cleanPhone], ...updatePayload };
            }
          }
          writeLocalJsonDb(dbData);
        } catch (_) { syncFailures++; }
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
        return res.status(500).json({ success: false, error: '改名同步失败，请重试' });
      }
      try { await logAdminOperation('rename', operatorPhone, cleanPhone, `改名为 ${cleanName}`, req); } catch (_) {}
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
      // 2026-10-20 重构(H1)：补角色白名单 + 等级比较 + 成员前置。此前任一管理人员可把自己或他人
      // 任意设为城市老板、或把老板降级，role 又直达鉴权身份推导，等于管理层内部互相改权。
      if (!(req as any).isAdmin && !(req as any).isManager && !(req as any).isDispatcher) {
        return res.status(403).json({ success: false, error: '仅管理人员可以调整职位' });
      }
      const { phone, role, city, remark } = req.body || {};
      const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不是司机，不能执行此操作' });
      }
      const cleanRole = String(role || '').trim().slice(0, 20);
      if (!/^1[3-9]\d{9}$/.test(cleanPhone) || !cleanRole) {
        return res.status(400).json({ success: false, error: '参数错误' });
      }
      if (cleanPhone === '15509601222') {
        return res.status(403).json({ success: false, error: '开发者角色不可调整' });
      }
      const ROLE_WHITELIST: Record<string, string> = {
        '普通司机': '普通司机', '普通': '普通司机',
        '城市派单员': '城市派单员司机', '城市派单员司机': '城市派单员司机',
        '城市管理': '城市管理司机', '城市管理司机': '城市管理司机',
        '城市老板': '城市老板司机', '城市老板司机': '城市老板司机', '总指挥官': '城市老板司机',
      };
      const canonicalRole = ROLE_WHITELIST[cleanRole];
      if (!canonicalRole) {
        return res.status(400).json({ success: false, error: '角色不合法' });
      }
      const operatorPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const targetM: any = await Promise.resolve(getUnifiedMembership(cleanPhone)).catch(() => null);
      if (!targetM || !targetM.isMember) {
        return res.status(404).json({ success: false, error: '该司机不是小队成员，无法调整职位' });
      }
      if (!(req as any).isAdmin) {
        const operatorM: any = await Promise.resolve(getUnifiedMembership(operatorPhone)).catch(() => null);
        const opLevel = membershipLevelUnified(operatorM);
        const targetLevel = membershipLevelUnified(targetM);
        const newLevel = membershipLevelUnified({ role: canonicalRole });
        if ((req as any).isDispatcher && !(req as any).isManager) {
          // 派单员仅可把普通司机设为普通司机（与派单台可分配角色口径一致）
          if (newLevel !== 0 || targetLevel !== 0) {
            return res.status(403).json({ success: false, error: '派单员只能调整普通司机的职位' });
          }
        } else if (cleanPhone === operatorPhone) {
          if (newLevel >= opLevel) {
            return res.status(403).json({ success: false, error: '不能提升自己的职位' });
          }
        } else if (!(opLevel > targetLevel && newLevel < opLevel)) {
          return res.status(403).json({ success: false, error: '只能把职位调整给等级低于自己的成员、且不能授予不低于自己的职位' });
        }
      }
      const now = new Date().toISOString();
      const updatePayload: any = { role: canonicalRole, userRole: canonicalRole, updatedAt: now };
      // 2026-10-21 第四轮(P1-8)：管理后台团队设置里选的城市与备注此前根本没进请求落库，
      // 管理员以为已划好辖区、实际没存。请求带了就一并落库（四表同写，与 role 同步）。
      if (city !== undefined && String(city).trim()) updatePayload.city = String(city).trim().slice(0, 20);
      if (remark !== undefined) updatePayload.remark = String(remark).trim().slice(0, 100);
      const positionCode = squadPositionCodeFromRole(canonicalRole);
      const cols = ['squad_members', 'driver_users', 'squad_applications', 'team_members'];
      let syncFailures = 0;
      const applyRoleLocal = (dbData: any) => {
        for (const col of cols) {
          if (dbData[col]?.[cleanPhone]) {
            const updated = { ...dbData[col][cleanPhone], ...updatePayload };
            // 2026-10-20 重构(L1)：team_members.squad_position 存编码，与 approve/update-driver-role 全局口径一致
            // 2026-10-21 第二轮修复(P1)：squad_members 同步写 squad_position——身份推导优先认此字段，
            // 只改 role 不改它会出现「降级不彻底」（旧 position=boss 的人被降为普通司机后仍是 isManager）。
            if (col === 'team_members' || col === 'squad_members') updated.squad_position = positionCode;
            dbData[col][cleanPhone] = updated;
          }
        }
      };
      if (isMySQLEnabled && mysqlPool) {
        for (const col of cols) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', [col, cleanPhone]);
            if (rows && rows.length > 0) {
              const raw = rows[0].data;
              const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const updated = { ...existing, ...updatePayload };
              if (col === 'team_members' || col === 'squad_members') {
                (updated as any).squad_position = positionCode;
              }
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', [col, cleanPhone, JSON.stringify(updated)]);
            }
          } catch (_) { syncFailures++; }
        }
        // 2026-10-20 重构(H3)：补本地 JSON 双写
        try {
          const dbData = readLocalJsonDb();
          applyRoleLocal(dbData);
          writeLocalJsonDb(dbData);
        } catch (_) { syncFailures++; }
      } else {
        const dbData = readLocalJsonDb();
        applyRoleLocal(dbData);
        writeLocalJsonDb(dbData);
      }
      if (syncFailures > 0) {
        return res.status(500).json({ success: false, error: '职位同步失败，请重试' });
      }
      try { await logAdminOperation('set-role', operatorPhone, cleanPhone, `职位调整为 ${canonicalRole}`, req); } catch (_) {}
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
      if (hasMerchantASuffix(phone)) {
        return res.status(400).json({ success: false, error: '商户账号（A后缀）不是司机，不能执行此操作' });
      }
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      if (cleanPhone === '15509601222') {
        return res.status(403).json({ success: false, error: '开发者不能被删除' });
      }
      // 2026-10-21 第二轮修复(P0)：删人补等级比较（rename/set-role 在 bf5634e4 已加，remove 当时漏了，
      // 实测城市管理可越级删除城市老板与同级管理）。口径与 rename 一致：非开发者删人须等级严格高于目标；
      // 目标非成员（清残留）按 0 级处理，管理人员仍可清理。
      if (!(req as any).isAdmin) {
        const operatorPhoneRm = String((req as any).authPhone || '').replace(/\D/g, '').trim();
        const operatorMRm: any = await Promise.resolve(getUnifiedMembership(operatorPhoneRm)).catch(() => null);
        const targetMRm: any = await Promise.resolve(getUnifiedMembership(cleanPhone)).catch(() => null);
        const opLevelRm = membershipLevelUnified(operatorMRm);
        const tgLevelRm = targetMRm && targetMRm.isMember ? membershipLevelUnified(targetMRm) : 0;
        if (!(opLevelRm > tgLevelRm)) {
          return res.status(403).json({ success: false, error: '不能删除同级或上级成员' });
        }
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
          is_squad_member: 0, inSquad: false, isOnline: false, // 2026-10-23 第十六轮：与定位表同口径标离线（此前只清定位，driver_users.isOnline 残留 true 且看门狗不扫此表，永不自愈）
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
        // P1-10 改版（2026-10-22 第八轮：删人不删定位文档（坐标只此一份，删了重加后无从恢复、派单永远跳过他；App 还开着时下一次 GPS 上报本就会重写，删除只坑 App 没在跑的人）。改为标记离线：被删期间成员过滤挡派单、附近页成员过滤+离线双挡显示；重加审批时恢复在线即可立刻接单。）：定位不删，标记离线（地图不再显示被删的人靠成员过滤+离线双挡）
        try {
          const [lRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['driver_locations', cleanPhone]);
          if (lRows && lRows.length > 0) {
            const ld = typeof lRows[0].data === 'string' ? JSON.parse(lRows[0].data) : lRows[0].data;
            ld.isOnline = false; ld.isBusy = false;
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
              [JSON.stringify(ld), 'driver_locations', cleanPhone]);
          }
        } catch (_) {}
        // 2026-10-20 重构(M6)：清线上单开通状态、乘客链接与进行中订单槽位（token 按用户拍板保留不删）
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['online_applications', cleanPhone]).catch(() => {});
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['passenger_links', cleanPhone]).catch(() => {});
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['active_orders', cleanPhone]).catch(() => {});
        // 2026-10-18用户拍板：删除=踢出但可重申请，不再拉黑token。
        // 被踢司机 token 保持有效，可直接重申请；接单权限由 is_squad_member=0 在业务层拦截。
        // 真正恶意的用 isBanned 封停。_config.removedPhones 仅保留历史数据，不再新增。
        // 2026-10-20 重建：MySQL 分支同步本地 JSON，防旧本地成员文档让被删者复活
        syncLocalRemove(cleanPhone, uData);
      } else {
        const dbData = readLocalJsonDb();
        if (dbData['squad_members']?.[cleanPhone]) delete dbData['squad_members'][cleanPhone];
        if (dbData['squad_applications']?.[cleanPhone]) delete dbData['squad_applications'][cleanPhone];
        if (dbData['team_members']?.[cleanPhone]) delete dbData['team_members'][cleanPhone];
        if (dbData['driver_locations']?.[cleanPhone]) dbData['driver_locations'][cleanPhone] = { ...dbData['driver_locations'][cleanPhone], isOnline: false, isBusy: false }; // 2026-10-22 第八轮：同 MySQL 分支，定位不删只标离线
        if (dbData['online_applications']?.[cleanPhone]) delete dbData['online_applications'][cleanPhone];
        if (dbData['passenger_links']?.[cleanPhone]) delete dbData['passenger_links'][cleanPhone];
        if (dbData['active_orders']?.[cleanPhone]) delete dbData['active_orders'][cleanPhone];
        if (!dbData['driver_users']) dbData['driver_users'] = {};
        const existing = dbData['driver_users'][cleanPhone] || {};
        // P1-10补漏(2026-10-15)：保留真名不洗成"司机+后四位"；保留vipExpiry
        dbData['driver_users'][cleanPhone] = { ...existing, phone: cleanPhone, phoneNumber: cleanPhone,
          role: '普通司机', userRole: '普通司机', status: '未加入小队', approvalStatus: '未加入小队',
          is_squad_member: 0, inSquad: false, isOnline: false, // 2026-10-23 第十六轮：同 MySQL 分支，移除即双表离线
          removedBy: String((req as any).authPhone || adminPhone || ''), removedAt: now, updatedAt: now };
        if (!dbData['config']) dbData['config'] = {};
        const cfg = dbData['config']['removed_squad_members'] || { phones: [] };
        const phones = Array.isArray(cfg.phones) ? cfg.phones : [];
        if (!phones.includes(cleanPhone)) phones.push(cleanPhone);
        dbData['config']['removed_squad_members'] = { phones, updatedAt: now };
        writeLocalJsonDb(dbData);
      }
      try { await logAdminOperation('remove', String((req as any).authPhone || ''), cleanPhone, '移出小队', req); } catch (_) {}
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Squad Remove] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Squad Remove Error' });
    }
  });

  // 2026-10-12 司机接单专用通道：原子认领，防止抢单竞态。不走鉴权。
  app.post('/api/order/driver-claim', requireDbAuth, orderLockMiddleware, async (req, res) => {
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
      // 2026-10-22 第六轮：改走 readDriverExpiryUnified 统一口径（原实现只读 driver_users 一表）
      try {
        const licExpiry2 = (await readDriverExpiryUnified(cleanDriverPhone)).licenseExpiry;
        if (!isLicenseValid(licExpiry2)) {
          return res.status(403).json({ success: false, error: '接单授权已到期，请联系开发者充值' });
        }
      } catch (e) {
        console.error('[DriverClaim] 接单授权校验异常:', (e as any)?.message);
        return res.status(503).json({ success: false, error: '授权校验失败，请重试' });
      }
      // P0(2026-10-15)：非VIP每日2单服务端强制限制
      try {
        const vipExpiry2 = (await readDriverExpiryUnified(cleanDriverPhone)).vipExpiry;
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
      // 2026-10-20 重建：大厅抢单补 removed 检查（与 claim 同口径，开发者豁免）
      if (cleanDriverPhone !== '15509601222') {
        const removedForClaim = await readRemovedPhonesMergedUnified();
        if (removedForClaim.includes(cleanDriverPhone)) {
          return res.status(403).json({ success: false, error: '您已被移出小队，请重新申请加入' });
        }
      }
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
      // 2026-10-22 第七轮：未决派单拦截——本人有未决派单（新来单弹窗未处理）时不许再抢大厅单，
      // 防一人同时持有两单。未决单就是本单时放行（弹窗确认主通道是 /api/order/claim，本接口
      // 仅异常时序兜底，订单维度校验在下方继续）。占用按事实计算、不读 isBusy 故不自锁；
      // /api/order/claim 本体不加此拦截——claim 的就是本人被派的那单，绝不能挡弹窗确认接单。
      try {
        const pendClaim = await getPendingDispatchForPhone(cleanDriverPhone, true); // 2026-10-22 第七轮善后：守卫必须读最新未决名单——TTL 缓存是给派单候选过滤用的，抢单守卫若读到派单前缓存的旧名单，未决拦截会被 1.5 秒时间窗绕过（实测 F2）
        if (pendClaim && pendClaim.orderId !== cleanOrderId) {
          return res.status(409).json({ success: false, error: '您有待处理的派单，请先处理后再抢单' });
        }
      } catch (_) {}
      // 2026-10-23 第二十一轮(H3)：订单事实占用校验（同 /api/order/claim 口径）——
      // 本人已有其他未终态的已接订单时不许再抢大厅单，防自清 isBusy 后一人双持。
      try {
        const activeOtherDc = await findDriverActiveOrderId(cleanDriverPhone, cleanOrderId);
        if (activeOtherDc) {
          return res.status(409).json({ success: false, error: '您已有进行中的订单，请完成后再抢单' });
        }
      } catch (_) {}
      // 2026-10-22 第八轮：拒单/超时名单服务端校验，与 App 大厅展示口径对齐（展示侧对
      // declined∪timeout 含本人的订单隐藏，抢单侧原先零校验，直调 API 可把刚拒掉的单抢回）。
      // 开发者/管理员豁免，与展示侧豁免一致。
      try {
        if (!(req as any).isAdmin) {
          const hallOrderDoc: any = await Promise.resolve(readCanonicalDocument('merchant_orders', cleanOrderId));
          const declinedList: string[] = [
            ...(Array.isArray(hallOrderDoc?.declinedDriverPhones) ? hallOrderDoc.declinedDriverPhones : []),
            ...(Array.isArray(hallOrderDoc?.timeoutDriverPhones) ? hallOrderDoc.timeoutDriverPhones : []),
          ].map((v: any) => String(v || '').replace(/\D/g, '').trim());
          if (declinedList.includes(cleanDriverPhone)) {
            return res.status(409).json({ success: false, error: '您已拒单或超时未接此单，不能再抢此单' });
          }
        }
      } catch (_) {}
      // 2026-10-23 第三十九轮：报单人不得抢回自己报单转单的订单。RT 派单环已排除
      // 发起人（绝不派给自己），但大厅抢单口此前零校验：报单进大厅后报单人能在
      // 自己大厅看到并抢回，绕过排除规则（且与报单弹窗「不会显示在您的选单大厅」
      // 的承诺不符）。与派单环同口径，不设管理员豁免：报单人身份本身即排除事由。
      try {
        const hallOrderDocRt: any = await Promise.resolve(readCanonicalDocument('merchant_orders', cleanOrderId));
        const reporterOfOrder = String(hallOrderDocRt?.reporterPhone || '').replace(/\D/g, '').trim();
        if (reporterOfOrder && reporterOfOrder === cleanDriverPhone) {
          return res.status(409).json({ success: false, error: '不能抢自己报单转单的订单' });
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
          // 2026-10-20 重构(P2)：按 orderId 字段精确匹配，不再用 LIKE 模糊匹配防误删文本中偶含该串的他人 link
          await mysqlPool.query(
            "DELETE FROM `daijia_documents` WHERE `collection` = 'passenger_links' AND JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.orderId')) = ?",
            [cleanOrderId]
          ).catch(() => {});
          // P1(2026-10-15)：大厅抢单成功后写busy，防连抢多单（与/api/order/claim同修）
          try {
            const _cols = ['driver_locations', 'driver_users'];
            for (let _ci = 0; _ci < _cols.length; _ci++) {
              await mysqlPool.query(
                'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", CAST(TRUE AS JSON)) WHERE `collection` = ? AND `doc_id` = ?',
                [_cols[_ci], cleanDriverPhone]
              ).catch(function() {});
            }
          } catch (_) {}
          // 2026-10-21 第四轮(P1-2)：MySQL 分支此前完全不写本地 JSON 镜像——订单在 JSON 里长期停在 hall，
          // 读 JSON 的路径（decline 守卫旧口径、部分列表）会把已接单订单当大厅单。成功后镜像回 JSON。
          try {
            const jdb = readLocalJsonDb();
            if (!jdb['merchant_orders']) jdb['merchant_orders'] = {};
            jdb['merchant_orders'][cleanOrderId] = updated;
            if (jdb['passenger_links']) {
              for (const [k, v] of Object.entries<any>(jdb['passenger_links'])) {
                const vid = String(v?.id || v?.orderId || v?.orderNo || '');
                if (vid === cleanOrderId) delete jdb['passenger_links'][k];
              }
            }
            for (const col of ['driver_locations', 'driver_users']) {
              if (jdb[col]?.[cleanDriverPhone]) {
                jdb[col][cleanDriverPhone] = { ...jdb[col][cleanDriverPhone], isBusy: true, lastStatusUpdateTime: now };
              }
            }
            writeLocalJsonDb(jdb);
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
          // 2026-10-21 第四轮(E1 实测)：JSON 分支此前漏写 isBusy——抢单成功却不显忙，
          // nearest 忙碌过滤看不见此人，同一人可被再派一单、还能再抢一单（一人双持两单）。
          // 与 MySQL 分支及 /api/order/claim 对齐：两表都置忙。
          for (const col of ['driver_locations', 'driver_users']) {
            if (dbData[col]?.[cleanDriverPhone]) {
              dbData[col][cleanDriverPhone] = { ...dbData[col][cleanDriverPhone], isBusy: true, lastStatusUpdateTime: now };
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
  app.post('/api/order/complete', requireDbAuth, orderLockMiddleware, async (req, res) => {
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
        // 2026-10-20 重构(P2)：已取消/已完成的订单不许被完单翻活
        if (['cancelled', '已取消', 'completed', '已完成'].includes(String(od.status || ''))) {
          return res.status(409).json({ success: false, error: '订单已完结，无法完成' });
        }
        // 2026-10-21 第四轮：未接单（仅被派单/已提交）的订单不许直接完成——必须先 claim 进入
        // 已接单/到达/服务中状态，否则被派司机可绕过接单环节凭空完结一单活派单。
        if (!['claimed', '已接单', 'arrived', 'serving', 'in_service', 'started'].includes(String(od.status || '')) &&
            !['已接单', '服务中', '计费中', '进行中'].includes(String(od.statusCategory || ''))) {
          return res.status(409).json({ success: false, error: '订单尚未接单，无法完成' });
        }
        od.status = 'completed';
        od.statusCategory = '已完成'; // 2026-10-23 第二十四轮：完单同步分类，防订单中心徽章永停「服务中」
        od.completedAt = now;
        od.updatedAt = now;
        // 2026-10-18修1：完单时存储司机端解析好的真实终点（名+坐标+里程），商户端/管理后台看终点才对得上
        {
          const destName = String(req.body?.endLocation || req.body?.destination || req.body?.dropoffName || '').trim();
          if (destName && destName !== '位置未知' && destName !== '目的地定位中...' && !/^(请填写|待指定|未完成|未填写)/.test(destName)) {
            od.endLocation = destName;
            od.destination = destName;
            od.dropoffName = destName;
          }
          const ec = req.body?.endCoords;
          if (ec && typeof ec.lng === 'number' && typeof ec.lat === 'number' && ec.lng > 0 && ec.lat > 0) {
            od.endCoords = { lng: ec.lng, lat: ec.lat };
          }
          const cdist = Number(req.body?.currentDistance);
          if (!isNaN(cdist) && cdist > 0) {
            od.currentDistance = cdist;
            od.distance = cdist;
          }
        }
        await mysqlPool.query(
          'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
          [JSON.stringify(od), 'merchant_orders', orderId]
        );
        // 2026-10-23 第二十五轮：完单同步清 active_orders（此前完单不在清除点之列，
        // active_orders[司机] 残留指向已完成单——2026-10-23 生产体检残留的代码根源）。
        // 按 orderId 守卫：只删指向本单的文档，防误删该司机另一笔行程。
        await mysqlPool.query(
          'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? AND (JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.orderId\')) = ? OR JSON_EXTRACT(`data`, \'$.orderId\') IS NULL)',
          ['active_orders', claimedBy, String(orderId)]
        ).catch((e: any) => console.error('[OrderComplete] 清理 active_orders 失败:', e?.message));
        // 重置司机busy状态
        for (const col of ['driver_locations', 'driver_users']) {
          try {
            const [drows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, authPhone]
            );
            if (drows && drows.length > 0) {
              const dd = typeof drows[0].data === 'string' ? JSON.parse(drows[0].data) : drows[0].data;
              dd.isBusy = false;
              await mysqlPool.query(
                'UPDATE `daijia_documents` SET `data` = ? WHERE `collection` = ? AND `doc_id` = ?',
                [JSON.stringify(dd), col, authPhone]
              );
            }
          } catch (_) {}
        }
        // 2026-10-21 第四轮(P1-2 同族)：完单结果镜像回本地 JSON，防镜像副本长期停在 claimed 态
        try {
          const jdb = readLocalJsonDb();
          if (!jdb['merchant_orders']) jdb['merchant_orders'] = {};
          jdb['merchant_orders'][orderId] = od;
          if (jdb['active_orders']?.[claimedBy]) {
            const aDoc: any = jdb['active_orders'][claimedBy];
            if (!aDoc?.orderId || String(aDoc.orderId) === String(orderId)) delete jdb['active_orders'][claimedBy];
          }
          for (const col of ['driver_locations', 'driver_users']) {
            if (jdb[col]?.[authPhone]) jdb[col][authPhone].isBusy = false;
          }
          writeLocalJsonDb(jdb);
        } catch (_) {}
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
        // 2026-10-20 重构(P2)：已取消/已完成的订单不许被完单翻活
        if (['cancelled', '已取消', 'completed', '已完成'].includes(String(od.status || ''))) {
          return res.status(409).json({ success: false, error: '订单已完结，无法完成' });
        }
        // 2026-10-21 第四轮：未接单（仅被派单/已提交）的订单不许直接完成——必须先 claim 进入
        // 已接单/到达/服务中状态，否则被派司机可绕过接单环节凭空完结一单活派单。
        if (!['claimed', '已接单', 'arrived', 'serving', 'in_service', 'started'].includes(String(od.status || '')) &&
            !['已接单', '服务中', '计费中', '进行中'].includes(String(od.statusCategory || ''))) {
          return res.status(409).json({ success: false, error: '订单尚未接单，无法完成' });
        }
        od.status = 'completed';
        od.statusCategory = '已完成'; // 2026-10-23 第二十四轮：完单同步分类，防订单中心徽章永停「服务中」
        od.completedAt = now;
        od.updatedAt = now;
        // 2026-10-18修1：完单时存储司机端解析好的真实终点（名+坐标+里程），商户端/管理后台看终点才对得上
        {
          const destName = String(req.body?.endLocation || req.body?.destination || req.body?.dropoffName || '').trim();
          if (destName && destName !== '位置未知' && destName !== '目的地定位中...' && !/^(请填写|待指定|未完成|未填写)/.test(destName)) {
            od.endLocation = destName;
            od.destination = destName;
            od.dropoffName = destName;
          }
          const ec = req.body?.endCoords;
          if (ec && typeof ec.lng === 'number' && typeof ec.lat === 'number' && ec.lng > 0 && ec.lat > 0) {
            od.endCoords = { lng: ec.lng, lat: ec.lat };
          }
          const cdist = Number(req.body?.currentDistance);
          if (!isNaN(cdist) && cdist > 0) {
            od.currentDistance = cdist;
            od.distance = cdist;
          }
        }
        for (const col of ['driver_locations', 'driver_users']) {
          if (dbData[col]?.[authPhone]) {
            dbData[col][authPhone].isBusy = false;
          }
        }
        // 2026-10-23 第二十五轮：同 MySQL 分支——完单清 active_orders（orderId 守卫）
        if (dbData['active_orders']?.[claimedBy]) {
          const aDoc: any = dbData['active_orders'][claimedBy];
          if (!aDoc?.orderId || String(aDoc.orderId) === String(orderId)) delete dbData['active_orders'][claimedBy];
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

      // 2026-10-20 重构：收款码以服务器为准（与派单同口径），不再采信客户端本地存的码；未在服务器上传过则为空
      const reporterQrUrl = fs.existsSync(path.join(process.cwd(), 'uploads', 'qrcodes', `${cleanReporter}.png`)) ? `/uploads/qrcodes/${cleanReporter}.png` : '';
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
        paymentQrCode: reporterQrUrl,
        merchantPaymentQrCode: reporterQrUrl,
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
      // 2026-10-22 第六轮：候选授权改统一口径——预载 driver_users（MySQL 优先、JSON 补缺），
      // 用 resolveExpiryFromDocs(成员文档, 档案文档) 解析，旧实现只读成员文档单表。
      const driverDocMapRt: Record<string, any> = {};
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [duRowsRt]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['driver_users']
          );
          (duRowsRt || []).forEach((r: any) => {
            try {
              const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              const p = String(r.doc_id || d?.phone || '').replace(/\D/g, '').trim();
              if (p) driverDocMapRt[p] = d;
            } catch (_) {}
          });
        } catch (_) {}
      }
      try {
        const jdbRt = readLocalJsonDb();
        Object.keys(jdbRt['driver_users'] || {}).forEach((k) => {
          const p = String(k).replace(/\D/g, '').trim();
          if (p && !driverDocMapRt[p]) driverDocMapRt[p] = jdbRt['driver_users'][k];
        });
      } catch (_) {}
      // 2026-10-12修复：报单人必须是小队正式成员，否则拒绝（防外部直接调接口）
      const removedPhonesArrRt = await readRemovedPhonesMergedUnified();
      const reporterEntry = squadList.find(m => m.phone === cleanReporter);
      // 2026-10-20 重建：开发者恒为成员（不受其文档 status 影响）；其余须已通过且不在 removed 名单
      const isReporterApproved = cleanReporter === '15509601222'
        ? true
        : (!!reporterEntry && isApproved(reporterEntry.data) && !removedPhonesArrRt.includes(cleanReporter));
      if (!isReporterApproved) {
        return res.status(403).json({ success: false, error: '仅小队正式成员可使用报单转单' });
      }
      // 2026-10-22 第七轮：与 /api/dispatch/nearest 同口径的占用事实（未决派单/报单心跳）
      const pendingMapRt = await getPendingDispatchMap();
      const candidates: any[] = [];
      const coordsValid = !isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0;
      if (coordsValid) {
        for (const m of squadList) {
          const phone = m.phone;
          if (!phone || phone === cleanReporter) continue; // 绝不派给自己
          if (!isApproved(m.data)) continue;
          if (phone !== '15509601222' && removedPhonesArrRt.includes(phone)) continue;
          // 接单授权检查 (2026-10-15)：天数为0不派转单
          // 2026-10-22 第六轮：改统一口径解析（成员文档优先、driver_users 兜底）
          if (!isLicenseValid(resolveExpiryFromDocs(m.data, driverDocMapRt[phone]).licenseExpiry)) continue;
          const loc = locationMap[phone];
          if (!loc) continue;
          const la = Number(loc.lat ?? loc.latitude);
          const lo = Number(loc.lng ?? loc.longitude);
          if (isNaN(la) || isNaN(lo) || la === 0 || lo === 0) continue;
          const updTs = docLatestTimeMs(loc); // 2026-10-24：取全部时间字段最大值，防陈旧字段遮蔽新鲜上报（见 docLatestTimeMs 注释）
          // P0(2026-10-16)：字段名与 /api/dispatch/nearest 同口径。之前读 loc.timestamp/loc.updatedAt/loc.lastUpdate
          // 三个不存在的字段，updTs 恒为 0，所有候选人被跳过，报单转单实际从未派单成功过、全部进了大厅。
          // 2026-10-12修复：无时间戳按过期处理（M2规则），不再放行幽灵司机
          if (!updTs || nowTs - updTs > 120000) continue; // GPS超120秒或无时间戳不派
          // 2026-10-12修复：必须明确 isOnline === true，undefined 不算在线
          const isOnline = loc.isOnline === true || loc.isOnline === 'true';
          const isBusy = loc.isBusy === true || loc.isBusy === "true" || loc.isBusy === 1;
          if (!isOnline || isBusy) continue;
          // 2026-10-22 第七轮：有未决派单或报单中的司机不派转单（与 nearest 同口径，事实计算不写 isBusy）
          if (occupancyOf(phone, pendingMapRt, loc).occupied) continue;
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
          // 2026-10-21 第四轮(P1-2 同族)：MySQL 成功后同步镜像本地 JSON——cancel 合并底稿、decline 守卫
          // 等读 JSON 的路径才不会拿到缺失/陈旧副本（此前报单转单的单在 JSON 里根本不存在）。
          try {
            const jdb = readLocalJsonDb();
            if (!jdb[col]) jdb[col] = {};
            jdb[col][docId] = data;
            writeLocalJsonDb(jdb);
          } catch (_) {}
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
          try {
            const jdb = readLocalJsonDb();
            if (jdb['passenger_links']?.[phone]) {
              delete jdb['passenger_links'][phone];
              writeLocalJsonDb(jdb);
            }
          } catch (_) {}
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
        // 2026-10-22 第七轮收尾：写前 fresh 复查（与 nearest 对齐）——候选过滤用的是 TTL 缓存图，
        // 窗内 chosen 刚被其他派单占用的话不许顶掉其未决单，本单落到下方转大厅。
        const pendRt = await getPendingDispatchForPhone(chosen.phone, true).catch(() => null);
        if (!pendRt || pendRt.orderId === cleanOrderId) {
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
      }

      // 3公里内无上线空闲司机 → 转入选单大厅
      const hallPayload = {
        ...baseOrder,
        status: 'hall',
        statusCategory: '等待接单',
        in_hall: true,
        hallAt: nowTs,
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
      // 2026-10-20修复：商户（A后缀）免申请，直接拒绝
      const rawPhone = String(phone || '').trim();
      if (rawPhone.toUpperCase().endsWith('A')) {
        return res.status(400).json({ success: false, error: '商户账号免申请，可直接使用' });
      }
      // P1-3: 申请人必须为本人，防冒名
      const tokenPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (cleanPhone !== tokenPhone && !(req as any).isAdmin) {
        return res.status(403).json({ success: false, error: '只能为本人提交申请' });
      }
      if (!cleanName) {
        return res.status(400).json({ success: false, error: '请填写真实姓名' });
      }
      // 2026-10-20 重建：状态迁移只走统一状态机——只允许 无记录/已拒绝 -> 待审核。
      // 检查失败必须关门（503），不再吞错后继续写；待审核重复提交幂等返回，不覆盖原申请。
      let membershipState: any;
      try {
        membershipState = await getUnifiedMembership(cleanPhone);
      } catch (e: any) {
        console.error('[Squad Apply] 状态检查失败:', e?.message);
        return res.status(503).json({ success: false, error: '状态校验失败，请重试' });
      }
      if (membershipState.isMember) {
        return res.status(400).json({ success: false, error: '您已是小队成员，无需重复提交' });
      }
      if (membershipState.phase === 'pending') {
        return res.json({ success: true, alreadyPending: true });
      }
      if (membershipState.applicationDoc && isApprovedMemberStatus(membershipState.applicationStatus)) {
        return res.status(409).json({ success: false, error: '申请状态异常，请联系管理人员处理' });
      }
      const appPayload = {
        id: cleanPhone, // 2026-10-22 第六轮(P0-1)：内嵌 id 必须等于文档键手机号（旧 'app-<时间戳>' 会被 db/list 过滤器误当身份，导致新申请在所有列表不可见）
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
        // 2026-10-20根治：同步一份到 local_db.json 镜像。
        // 通用 /api/db/set|update 的镜像逻辑以 JSON 为底稿，只写 MySQL 会让 JSON
        // 残留 /api/driver/name 建的"姓名壳"，后续镜像触发时覆盖好申请（status 丢失根因）。
        try {
          const dbData = readLocalJsonDb();
          if (!dbData.squad_applications) dbData.squad_applications = {};
          dbData.squad_applications[cleanPhone] = appPayload;
          writeLocalJsonDb(dbData);
        } catch (_) {}
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

  // 2026-10-20 新增：撤回小队申请（审核中点“重新填写”时调用）。
  // 服务端删除上次申请记录（MySQL + 本地 JSON 双存储），App 状态机随之回到申请表单。
  app.post('/api/squad-apply/withdraw', requireDbAuth, async (req, res) => {
    try {
      const { phone } = req.body || {};
      const cleanPhone = String(phone || (req as any).authPhone || '').replace(/\D/g, '').trim();
      if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: '手机号格式错误' });
      }
      const requesterPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      if (cleanPhone !== requesterPhone && !(req as any).isAdmin && !(req as any).isManager && !(req as any).isDispatcher) {
        return res.status(403).json({ success: false, error: '无权撤回他人申请（仅本人或管理层可操作）' });
      }
      const isProxyWithdraw = cleanPhone !== requesterPhone;
      let state: any;
      try {
        state = await getUnifiedMembership(cleanPhone);
      } catch (e: any) {
        console.error('[Squad Withdraw] 状态检查失败:', e?.message);
        return res.status(503).json({ success: false, error: '状态校验失败，请重试' });
      }
      if (state.isMember) {
        return res.status(409).json({ success: false, error: '已是小队成员，无需撤回' });
      }
      if (!state.applicationDoc) {
        return res.status(404).json({ success: false, error: '申请不存在' });
      }
      if (!['待审核', 'pending', '审核中', '已拒绝'].includes(state.applicationStatus)) {
        return res.status(409).json({ success: false, error: '当前申请状态不可撤回' });
      }
      if (isMySQLEnabled && mysqlPool) {
        await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
          ['squad_applications', cleanPhone]);
      }
      syncLocalWithdraw(cleanPhone);
      // 2026-10-21 第三轮：管理层代撤此前无痕，现补审计日志（与文案口径对齐）
      if (isProxyWithdraw) {
        await logAdminOperation('withdraw-application', requesterPhone, cleanPhone, `管理层代撤回 ${cleanPhone} 的入队申请`, req);
      }
      return res.json({ success: true, withdrawn: true });
    } catch (err: any) {
      console.error('[Squad Withdraw] error:', err);
      res.status(500).json({ success: false, error: err.message || 'Withdraw Error' });
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
  const qrStaticGuard = (req: any, res: any, next: any) => {
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
  };
  app.use('/uploads/qrcodes', requireDbAuth, qrStaticGuard);
  // 2026-10-21 第三轮(P1-1)：qrs 是 qrcodes 的历史副本目录，此前只挂了 express.static 无鉴权，
  // 任何人拼 /uploads/qrs/{手机号}.png 即可枚举下载全员收款码。现与 qrcodes 同守卫。
  app.use('/uploads/qrs', requireDbAuth, qrStaticGuard);
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  // 2026-10-23 第四十轮二修：收款码目录里不存在的文件必须明确 404，不许穿透到
  // 后面的 SPA 回退页（会返回 200+HTML，客户端把 HTML 当图片渲染成破图）。
  app.use(['/uploads/qrcodes', '/uploads/qrs'], (req: any, res: any) => {
    return res.status(404).json({ success: false, error: 'Not found' });
  });
  // 2026-10-21 第四轮(P0-1)：部署包与服务端构建产物不许经静态托管裸奔——public/ 与 dist/ 里
  // 若放了部署 zip / server.cjs，静态中间件会绕过下载接口的鉴权直接发出去。
  // 包文件先过开发者校验再放行后续静态/路由；server.cjs(.map) 一律拒绝（前端资源只在 /assets 下）。
  app.use(async (req: any, res: any, next: any) => {
    const p = String(req.path || '');
    if (/^\/server\.cjs(\.map)?$/i.test(p)) {
      return res.status(403).json({ success: false, error: '禁止访问' });
    }
    if (/^\/(daijia_deploy|baota_deploy|deploy)\.(zip|tar\.gz|tar)$/i.test(p)) {
      if (await verifyDeveloperDownload(req)) return next();
      return res.status(403).json({ success: false, error: '部署包下载需要开发者登录' });
    }
    next();
  });
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
      // 2026-10-24 第四十八轮：原实现只剥 data:image 前缀、不验内容，任意字节都能冒充 PNG 落盘
      // （实验室实证：HTML 文本上传回 200）。收款码文件按 .png 对外提供，补图片魔数校验：
      // 只接受 PNG/JPEG/WebP/GIF 真实图片，既防伪装文件，也防损坏数据静默写坏自己的收款码。
      const isRealImage =
        (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) || // PNG
        (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) || // JPEG
        (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') || // WebP
        (buffer.length > 6 && buffer.toString('ascii', 0, 4) === 'GIF8'); // GIF
      if (!isRealImage) {
        return res.status(400).json({ error: '文件不是有效图片，请重新选择收款码图片' });
      }

      // A后缀判断必须用原始phone（strip前），否则永假
      const isWeb = channel === 'web' || channel === 'mobile_web' || rawPhone.endsWith('A');
      // P0-5修复(2026-10-15)：文件名保留A后缀，商户15509601222A与司机15509601222账号隔离不串码
      const filePhone = rawPhone.endsWith('A') ? `${cleanPhone}A` : cleanPhone;
      const filename = isWeb ? `${filePhone}_web.png` : `${filePhone}.png`;
      const filepath = path.join(qrcodesDir, filename);

      // Overwrite/replace file on server disk (Baota panel) - Guaranteed single file per account
      // 2026-10-21 第三轮(P1-1)：不再往 uploads/qrs 写副本（该目录曾无鉴权裸奔）；新码只写 qrcodes 一处，
      // qrs 存量旧文件仍可经同守卫读取（见上方 qrStaticGuard）。
      await fs.promises.writeFile(filepath, buffer);

      if (!isWeb) {
        try {
          const appFilepath = path.join(qrcodesDir, `${filePhone}_app.png`);
          await fs.promises.writeFile(appFilepath, buffer);
        } catch (_) {}
      }
      
      const qrUrl = `/uploads/qrcodes/${filename}?t=${Date.now()}`;
      
      // Update MySQL & Local DB collections safely via merge (NEVER replace entire driver profile)
      const targetCols = isWeb 
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users']
        : ['app_valet_qrs', 'dispatch_qrs', 'dispatch_qrcodes', 'driver_users']; // 2026-10-21 第三轮(P2-2)：去掉 squad_members——上传收款码不得给非成员建成员壳文档，成员表只由状态机写

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
          // 2026-10-23 第十五轮：JSON 镜像键与 MySQL doc_id 对齐用 filePhone（保留 A 后缀）。
          // 旧写法用去 A 的 cleanPhone 作键、文档内 id 却是 filePhone，商户码在镜像里键实不符，
          // MySQL 故障回退 JSON 时按 A 形态查不到商户收款码。
          dbData[col][filePhone] = { ...(dbData[col][filePhone] || {}), ...qrPayload };
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
      // 2026-10-23 第四十轮二修：代叫费页每 2 秒轮询本接口（30 次/分），旧上限 20/分
      // 在页面停留约 40 秒后必然触发 429，轮询在成功/被限流之间横跳。接口本身有
      // 登录+订单关联鉴权，放宽到 60/分兼顾页面轮询与防枚举。
      if (qrLogs.length >= 60) {
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
        // 2026-10-22 第八轮：web 专属文件缺失时回退 app 通道文件名（同一人的码）——
        // 商户只在 App 里传过码、又在网页下单时，旧实现查不到码显示「未设置」。
        if (fs.existsSync(path.join(qrcodesDir, appFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appFilename}?t=${stat.mtimeMs}`, channel: 'web' });
        }
        if (fs.existsSync(path.join(qrsDir, appFilename))) {
          const stat = fs.statSync(path.join(qrsDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: 'web' });
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
                // 第四十轮二修补强：路径型旧值先验文件真存在，不在当没查到（详见 JSON 分支同注）
                const pth = foundQr.trim().split('?')[0];
                if (pth.startsWith('/uploads/') && !fs.existsSync(path.join(process.cwd(), pth))) {
                  continue;
                }
                return res.json({ success: true, url: foundQr, channel: isWeb ? 'web' : 'app' });
              }
            }
          } catch (_) {}
        }
      }

      // 2026-10-23 第二十五轮：MySQL 启用时集合解析只认 MySQL。旧实现在 MySQL 六集合全空后
      // 无条件续查 JSON 镜像——删码后镜像残留的旧码会被重新解析出来（已删除的码复活）。
      // JSON 扫描仅在 MySQL 未启用（镜像即权威）时执行；文件存在性检查不受影响。
      if (!isMySQLEnabled || !mysqlPool) {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (dbData[col] && dbData[col][phone]) {
            const rowData = dbData[col][phone];
            const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
            if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
              const pth = foundQr.trim().split('?')[0];
              if (pth.startsWith('/uploads/') && !fs.existsSync(path.join(process.cwd(), pth))) {
                continue;
              }
              return res.json({ success: true, url: foundQr, channel: isWeb ? 'web' : 'app' });
            }
          }
        }
      }

      // Fallback check standard file if web specific not yet uploaded
      if (fs.existsSync(path.join(qrsDir, appFilename))) {
        const stat = fs.statSync(path.join(qrsDir, appFilename));
        return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: 'fallback' });
      }

      // 2026-10-23 第四十轮：同一人双形态兜底——码只以商户 A 形态（*_web.png）存着、
      // 代叫费页却按纯号+app 渠道来查时（商户在 App 内以管理员身份下单、订单
      // merchantPhone 为纯号无 web 标记），主形态全查空会误报「QR not found」，
      // 费用页据此把订单自带码一并清掉，二维码闪 2-3 秒后只剩 alt 文字（真机实测）。
      // 此处按相同数字的另一形态再查一遍文件与集合（仅同人同号、不跨账号），命中即返回。
      try {
        const altPhone = phone.endsWith('A') ? phoneDigits : `${phoneDigits}A`;
        const altIsWeb = !isWeb;
        const altWebFile = `${altPhone}_web.png`;
        const altAppFile = `${altPhone}.png`;
        const altAppSpecific = `${altPhone}_app.png`;
        const altCandidates: Array<[string, string]> = altIsWeb
          ? [[qrcodesDir, altWebFile], [qrsDir, altWebFile], [qrcodesDir, altAppFile], [qrsDir, altAppFile]]
          : [[qrcodesDir, altAppSpecific], [qrcodesDir, altAppFile], [qrsDir, altAppSpecific], [qrsDir, altAppFile]];
        for (const [dir, fn] of altCandidates) {
          const fp = path.join(dir, fn);
          if (fs.existsSync(fp)) {
            const stat = fs.statSync(fp);
            const dirName = dir === qrsDir ? 'qrs' : 'qrcodes';
            return res.json({ success: true, url: `/uploads/${dirName}/${fn}?t=${stat.mtimeMs}`, channel: altIsWeb ? 'web' : 'app' });
          }
        }
        const altCols = altIsWeb
          ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users', 'dispatch_qrs', 'dispatch_qrcodes', 'driver_users']
          : ['app_valet_qrs', 'driver_users', 'dispatch_qrs', 'dispatch_qrcodes', 'web_valet_qrs', 'merchant_users'];
        if (isMySQLEnabled && mysqlPool) {
          for (const col of altCols) {
            try {
              const [rows]: any = await mysqlPool.query(
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                [col, altPhone]
              );
              if (rows && rows.length > 0) {
                const rowData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
                const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
                if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
                  const pth = foundQr.trim().split('?')[0];
                  if (pth.startsWith('/uploads/') && !fs.existsSync(path.join(process.cwd(), pth))) {
                    continue;
                  }
                  return res.json({ success: true, url: foundQr, channel: altIsWeb ? 'web' : 'app' });
                }
              }
            } catch (_) {}
          }
        }
        if (!isMySQLEnabled || !mysqlPool) {
          const dbDataAlt = readLocalJsonDb();
          for (const col of altCols) {
            const rowData = dbDataAlt[col]?.[altPhone];
            const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
            if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
              const pth = foundQr.trim().split('?')[0];
              if (pth.startsWith('/uploads/') && !fs.existsSync(path.join(process.cwd(), pth))) {
                continue;
              }
              return res.json({ success: true, url: foundQr, channel: altIsWeb ? 'web' : 'app' });
            }
          }
        }
      } catch (_) {}

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
          // 2026-10-23 第二十六轮：改用归一化 filePhone（与上传/其余删除处同口径）——
          // 原始 phone 带小写 a 形态时这两处按错键删空，A 商户的码集删不掉。
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', ['dispatch_qrs', filePhone]);
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', ['dispatch_qrcodes', filePhone]);
          // 2026-10-23 第十五轮补漏：上传按渠道分流（web/A 商户→web_valet_qrs/dispatch_qrs_web/
          // merchant_users；app→app_valet_qrs），删除此前只清 app 侧两集，商户删码后
          // merchant_users 等文档仍指着已删文件、解析出死链。按 filePhone 同口径补清：
          // 纯码集合整档删，merchant_users 可能含商户资料，只清码字段。
          for (const wcol of ['web_valet_qrs', 'dispatch_qrs_web', 'app_valet_qrs']) {
            await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', [wcol, filePhone]).catch(() => {});
          }
          const [muRows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['merchant_users', filePhone]).catch(() => [[]]);
          if (muRows && muRows.length > 0) {
            const muPrev = typeof muRows[0].data === 'string' ? JSON.parse(muRows[0].data) : muRows[0].data;
            muPrev.wechatQrCode = '';
            muPrev.qrCode = '';
            muPrev.qrcode_url = '';
            muPrev.wechatClean = ''; // 第二十六轮：同上
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['merchant_users', filePhone, JSON.stringify(muPrev)]);
          }
          
          const [rows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', phone]);
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            prev.wechatQrCode = '';
            prev.qrCode = '';
            prev.qrcode_url = ''; // 第二十六轮：与 JSON 分支对齐补清（此前 MySQL 独留死链）
            prev.wechatClean = ''; // 第二十六轮：解析侧仍认此字段，删除侧必须同清
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['driver_users', phone, JSON.stringify(prev)]);
          }

          const [squadRows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['squad_members', phone]);
          if (squadRows && squadRows.length > 0) {
            const squadPrev = typeof squadRows[0].data === 'string' ? JSON.parse(squadRows[0].data) : squadRows[0].data;
            squadPrev.wechatQrCode = '';
            squadPrev.qrCode = '';
            squadPrev.qrcode_url = ''; // 第二十六轮：同 driver_users
            squadPrev.wechatClean = '';
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['squad_members', phone, JSON.stringify(squadPrev)]);
          }
        } catch (err: any) {
          console.error('[MySQL delete-wechat-qr error]:', err);
        }
      }

      const dbData = readLocalJsonDb();
      if (dbData.dispatch_qrs && dbData.dispatch_qrs[phone]) delete dbData.dispatch_qrs[phone];
      if (dbData.dispatch_qrcodes && dbData.dispatch_qrcodes[phone]) delete dbData.dispatch_qrcodes[phone];
      // 2026-10-23 第十五轮补漏：同 MySQL 分支，补清 web/app 渠道集合（键为 filePhone）。
      for (const wcol of ['web_valet_qrs', 'dispatch_qrs_web', 'app_valet_qrs']) {
        if (dbData[wcol] && dbData[wcol][filePhone]) delete dbData[wcol][filePhone];
      }
      if (dbData.merchant_users && dbData.merchant_users[filePhone]) {
        dbData.merchant_users[filePhone].wechatQrCode = '';
        dbData.merchant_users[filePhone].qrCode = '';
        dbData.merchant_users[filePhone].qrcode_url = '';
      }
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
    // 2026-10-24 第四十八轮：旧版乘客页下线跳转。旧页仍调已下线的 /api/submit（410）
    // 与需鉴权的 /api/db/get（401），功能全死、乘客点了下单只会报错；且旧页语义是
    // 「匿名直接建单派单」，与现行「只通知司机、不建单」设计相冲突。凡是还印着/存着
    // 旧链接的二维码，一律 302 到现行乘客页并透传查询串（driver 等参数不丢）。
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, '/passenger_order.html' + qs);
  });

  // Helper for binary-safe file download stream (.zip, .tar.gz, .tar)
  // 2026-10-21 第四轮(P0-1)：部署包内含全套源码与硬编码短信密钥，此前任何人无鉴权即可下载盗刷短信费。
  // 下载类接口一律要求开发者 token（X-Auth-Token），与管理后台下载按钮（带鉴权头）对齐。
  const verifyDeveloperDownload = async (req: any): Promise<boolean> => {
    try {
      const token = String(req?.headers?.['x-auth-token'] || '').trim();
      if (!token) return false;
      const persistent: any = await verifyPersistentToken(token).catch(() => null);
      const phone = String(persistent?.phone || authTokens.get(token)?.phone || '').replace(/\D/g, '').trim();
      return phone === DEVELOPER_PHONE_SERVER;
    } catch (_) { return false; }
  };

  const servePackageFile = async (req: express.Request, res: express.Response, requestedName = 'daijia_deploy.zip') => {
    if (!(await verifyDeveloperDownload(req))) {
      return res.status(403).json({ success: false, error: '部署包下载需要开发者登录' });
    }
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
  // 2026-10-24 第四十九轮安全修复（实验室实证）：原条件 NODE_ENV!=="production" 时加载 Vite 开发
  // 中间件——宝塔启动若未显式设 NODE_ENV=production，生产会误跑开发模式：Vite 的 /@fs/ 可无鉴权
  // 读取进程 cwd 内任意文件（实测无 token 读出 local_db.json 全量含 tokenSecret 与全部登录 token、
  // canary 文件同理），且 HMR WebSocket(24678) 无凭证可连。改为显式 opt-in：仅
  // NODE_ENV==="development" 才加载开发中间件，其余（production/未设/任何值）一律走静态生产分支。
  if (process.env.NODE_ENV === "development") {
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
